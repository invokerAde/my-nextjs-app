/**
 * Visualization Generation — AI SDK structured output for chart spec.
 *
 * Replaces rule-based heuristics with LLM-driven chart type selection.
 * The AI output is validated/normalized before returning to the frontend.
 */

import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';

// ── v2 Spec ──

export type VisualizationSpec =
  | BarLineSpec
  | PieSpec;

export interface BarLineSpec {
  schemaVersion: 2;
  type: 'bar' | 'line';
  title: string;
  xAxis: { field: string; label?: string };
  series: { field: string; label?: string }[];
}

export interface PieSpec {
  schemaVersion: 2;
  type: 'pie';
  title: string;
  categoryField: string;
  valueField: string;
}

// ── Config ──

const MODEL = process.env.TEXT2SQL_VIS_MODEL
  || process.env.TEXT2SQL_MODEL
  || process.env.OPENAI_CHAT_MODEL
  || 'gpt-4o-mini';

const TIMEOUT_MS = Number(process.env.TEXT2SQL_VIS_TIMEOUT_MS) || 15000;
const MAX_TITLE_LENGTH = 80;
const MAX_SERIES = 4;
const MAX_PREVIEW_ROWS = 20;

// ── AI Provider ──

let _provider: ReturnType<typeof createOpenAICompatible> | null = null;

function getProvider() {
  if (!_provider) {
    _provider = createOpenAICompatible({
      name: 'text2sql-vis',
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL!,
      supportsStructuredOutputs: false,
    });
  }
  return _provider;
}

// ── Zod schema for AI output ──

const chartTypeEnum = z.enum(['bar', 'line', 'pie', 'none']);

const aiOutputSchema = z.object({
  chartType: chartTypeEnum.describe(
    'bar, line, pie, or none if the data is not suitable for charting'
  ),
  title: z.string().describe('Short chart title in the same language as the user question'),
  xField: z.string().nullish().describe(
    'Column name for X axis (bar/line). Null for pie or none.'
  ),
  yFields: z.array(z.string()).nullish().describe(
    'Numeric column names for Y axis (bar/line). Null for pie or none.'
  ),
  categoryField: z.string().nullish().describe(
    'Column name for pie categories. Null for bar/line or none.'
  ),
  valueField: z.string().nullish().describe(
    'Numeric column name for pie values. Null for bar/line or none.'
  ),
});

type AIOutput = z.infer<typeof aiOutputSchema>;

// ── Helpers ──

function buildPrompt(question: string, columns: string[], rows: Record<string, unknown>[]): string {
  const preview = rows.slice(0, MAX_PREVIEW_ROWS);
  const header = columns.join(' | ');
  const sampleRows = preview
    .map(r => columns.map(c => formatCell(r[c])).join(' | '))
    .join('\n');

  return `The user asked: "${question}"

SQL result columns: [${columns.join(', ')}]
Row count: ${rows.length}

Preview (up to ${MAX_PREVIEW_ROWS} rows):
${header}
${sampleRows}

Choose the best chart type and respond with ONLY this exact JSON format (no markdown, no extra text):

For bar/line charts:
{"chartType":"bar","title":"<title>","xField":"<column>","yFields":["<col1>","<col2>"]}

For pie charts:
{"chartType":"pie","title":"<title>","categoryField":"<column>","valueField":"<column>"}

For no chart:
{"chartType":"none","title":"","xField":null,"yFields":null,"categoryField":null,"valueField":null}

Rules:
- chartType must be "bar", "line", "pie", or "none".
- Use line for time series or ordered sequences.
- Use bar for comparing categories.
- Use pie for distribution/proportion (few categories, non-negative values).
- Use none if data is a plain list or has no numeric dimension.
- Field names must EXACTLY match the column names above.`;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  const s = String(value);
  return s.length > 50 ? s.slice(0, 47) + '...' : s;
}

function truncateTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) return title;
  return title.slice(0, MAX_TITLE_LENGTH - 3) + '...';
}

// ── Normalization ──

function normalizeVisualizationIntent(
  ai: AIOutput,
  columns: string[],
  rows: Record<string, unknown>[],
): VisualizationSpec | null {
  if (!columns.length || !rows.length) return null;
  if (ai.chartType === 'none') return null;

  const colSet = new Set(columns);

  if (ai.chartType === 'pie') {
    const catField = ai.categoryField;
    const valField = ai.valueField;
    if (!catField || !valField) return null;
    if (!colSet.has(catField) || !colSet.has(valField)) return null;

    // Validate value field is numeric and non-negative
    if (!rows.every(r => {
      const v = Number(r[valField]);
      return !isNaN(v) && v >= 0;
    })) return null;

    return {
      schemaVersion: 2,
      type: 'pie',
      title: truncateTitle(ai.title),
      categoryField: catField,
      valueField: valField,
    };
  }

  if (ai.chartType === 'bar' || ai.chartType === 'line') {
    const xField = ai.xField;
    const yFields = (ai.yFields || []).filter(Boolean).slice(0, MAX_SERIES);
    if (!xField || yFields.length === 0) return null;
    if (!colSet.has(xField)) return null;
    if (!yFields.every(f => colSet.has(f))) return null;

    // Validate yFields contain finite numbers
    for (const f of yFields) {
      if (!rows.some(r => {
        const v = Number(r[f]);
        return !isNaN(v) && isFinite(v);
      })) return null;
    }

    return {
      schemaVersion: 2,
      type: ai.chartType,
      title: truncateTitle(ai.title),
      xAxis: { field: xField },
      series: yFields.map(f => ({ field: f })),
    };
  }

  return null;
}

// ── Main entry point ──

export interface VisualizationResult {
  visualization: VisualizationSpec | null;
  warning?: string;
}

function parseAIResponse(text: string): AIOutput | null {
  // Try to extract JSON from markdown fences or raw text
  const trimmed = text.trim();
  let jsonStr = trimmed;

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return aiOutputSchema.parse(parsed);
  } catch {
    // Try to find a JSON object anywhere in the text
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        const parsed = JSON.parse(objMatch[0]);
        return aiOutputSchema.parse(parsed);
      } catch { /* fall through */ }
    }
    return null;
  }
}

export async function generateVisualizationSpec(params: {
  question: string;
  columns: string[];
  rows: Record<string, unknown>[];
}): Promise<VisualizationResult> {
  const { question, columns, rows } = params;

  if (!columns.length || !rows.length) {
    return { visualization: null };
  }

  const model = getProvider()(MODEL);

  try {
    const prompt = buildPrompt(question, columns, rows);

    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: 300,
      temperature: 0,
    });

    const output = parseAIResponse(text);

    if (!output) {
      return {
        visualization: null,
        warning: `Visualization parse error: AI response was not valid JSON`,
      };
    }

    const normalized = normalizeVisualizationIntent(output, columns, rows);

    if (!normalized && output.chartType !== 'none') {
      return {
        visualization: null,
        warning: `AI suggested chartType="${output.chartType}" but normalization rejected it`,
      };
    }

    return { visualization: normalized };
  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg.includes('timeout') || msg.includes('abort') || msg.includes('ETIMEDOUT')) {
      return { visualization: null, warning: 'Visualization AI timeout' };
    }
    return { visualization: null, warning: `Visualization AI error: ${msg.slice(0, 100)}` };
  }
}
