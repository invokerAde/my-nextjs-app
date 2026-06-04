/**
 * Admin Text2SQL Agent.
 *
 * Pipeline: Knowledge Retrieval → Prompt Assembly → LLM Generation →
 *           SQL Validation → Execution → Error Reflection Retry
 *
 * Pure service — no HTTP dependencies. The API route handles auth and request parsing.
 */

import OpenAI from 'openai';
import { validateAdminSQL, validateQuestion } from './validator';
import { VIEW_DDL, FIELD_DESCRIPTIONS, FEW_SHOT_EXAMPLES, ANALYTICS_VIEWS } from './knowledge';

// ── Config ──

const MODEL = process.env.TEXT2SQL_MODEL || process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const MAX_ROWS = Number(process.env.TEXT2SQL_MAX_ROWS) || 100;
const MAX_RETRIES = Number(process.env.TEXT2SQL_MAX_RETRIES) || 2;
const TIMEOUT_MS = Number(process.env.TEXT2SQL_TIMEOUT_MS) || 8000;
const EXEC_TIMEOUT_MS = Number(process.env.TEXT2SQL_EXEC_TIMEOUT_MS) || 5000;

// ── Types ──

export interface Text2SQLRequest {
  question: string;
  dryRun?: boolean;
  maxRows?: number;
}

export interface Text2SQLResponse {
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  attempts: number;
  executionMs: number;
  warnings: string[];
  knowledgeSources: string[];
}

// ── Prompt assembly ──

function buildSystemPrompt(): string {
  const ddlSection = ANALYTICS_VIEWS
    .map(v => VIEW_DDL[v])
    .join('\n\n');

  const fieldSection = FIELD_DESCRIPTIONS
    .map(f => `  ${f.view}.${f.field}: ${f.description}`)
    .join('\n');

  const fewShotSection = FEW_SHOT_EXAMPLES
    .map((e, i) => `Example ${i + 1}:\nQ: ${e.question}\nSQL: ${e.sql}`)
    .join('\n\n');

  return `You are a PostgreSQL SQL generator for an admin analytics dashboard.

## Available Views (DDL)
${ddlSection}

## Field Descriptions
${fieldSection}

## Rules
- ONLY SELECT queries.
- ONLY use the views listed above — never reference raw tables (Product, User, Order, etc.).
- Use PostgreSQL-compliant SQL syntax.
- Use ILIKE for case-insensitive text matching.
- Use NOW() and INTERVAL for time-based queries.
- Always include ORDER BY when ranking or trends.
- Return ONLY the raw SQL. No markdown, no explanation.

## Few-Shot Examples
${fewShotSection}`;
}

// ── LLM client ──

let clientCache: OpenAI | null = null;
function getClient(): OpenAI {
  if (!clientCache) {
    const baseURL = process.env.OPENAI_BASE_URL;
    clientCache = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      ...(baseURL ? { baseURL } : {}),
      timeout: TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  return clientCache;
}

async function generateSQL(question: string, extraContext?: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt() },
    ];

    if (extraContext) {
      messages.push({
        role: 'user',
        content: `Previous attempt failed:\n${extraContext}\n\nPlease fix the SQL based on the error above. Question: ${question}`,
      });
    } else {
      messages.push({ role: 'user', content: `Question: ${question}` });
    }

    const completion = await getClient().chat.completions.create(
      {
        model: MODEL,
        messages,
        temperature: 0,
        max_tokens: 600,
      },
      { signal: controller.signal },
    );

    const raw = completion.choices[0]?.message?.content?.trim() || '';
    // Strip markdown code fences if present
    return raw.replace(/^```sql\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Execution ──

async function executeReadonlySQL(
  sql: string,
  maxRows: number,
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; ms: number }> {
  const start = Date.now();

  // Dynamic import to avoid Prisma ESM issues in test environments
  const { prisma } = await import('@/lib/rag/db');

  const result = await Promise.race([
    (prisma.$queryRawUnsafe as (sql: string) => Promise<Record<string, unknown>[]>)(sql),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('SQL execution timeout')), EXEC_TIMEOUT_MS),
    ),
  ]);

  const columns = result.length > 0 ? Object.keys(result[0]) : [];
  return {
    columns,
    rows: result.slice(0, maxRows),
    ms: Date.now() - start,
  };
}

// ── Main export ──

export async function runText2SQL(req: Text2SQLRequest): Promise<Text2SQLResponse> {
  const { question, dryRun = false, maxRows = MAX_ROWS } = req;

  // Validate question
  const qCheck = validateQuestion(question);
  if (!qCheck.valid) {
    throw new Error(qCheck.error);
  }

  const warnings: string[] = [];
  const startTime = Date.now();

  let sql = '';
  let attempt = 0;
  let lastError = '';

  // ── Generation + validation loop ──
  while (attempt < MAX_RETRIES + 1) {
    attempt++;

    try {
      const extraContext = lastError
        ? `Error: ${lastError}\nOriginal SQL: ${sql}`
        : undefined;
      sql = await generateSQL(question, extraContext);
    } catch (err: any) {
      if (attempt <= MAX_RETRIES) {
        lastError = `LLM call failed: ${err.message}`;
        continue;
      }
      throw new Error(`Text2SQL failed after ${attempt} attempts: ${err.message}`);
    }

    // Validate
    const validation = validateAdminSQL(sql, maxRows);
    if (!validation.valid) {
      if (attempt <= MAX_RETRIES) {
        lastError = `Validation failed: ${validation.error}`;
        continue;
      }
      throw new Error(`SQL validation failed after ${attempt} attempts: ${validation.error}`);
    }
    sql = validation.sql;

    break;
  }

  // ── Dry run: return SQL only ──
  if (dryRun) {
    return {
      sql,
      columns: [],
      rows: [],
      rowCount: 0,
      attempts: attempt,
      executionMs: Date.now() - startTime,
      warnings: [...warnings, 'dryRun=true — SQL not executed'],
      knowledgeSources: ['prompt-embedded-ddl', 'prompt-embedded-few-shot'],
    };
  }

  // ── Execution with retry ──
  let execStart = Date.now();
  for (let execAttempt = 0; execAttempt <= MAX_RETRIES; execAttempt++) {
    try {
      const { columns, rows, ms } = await executeReadonlySQL(sql, maxRows);
      return {
        sql,
        columns,
        rows,
        rowCount: rows.length,
        attempts: attempt,
        executionMs: ms,
        warnings,
        knowledgeSources: ['prompt-embedded-ddl', 'prompt-embedded-few-shot'],
      };
    } catch (err: any) {
      const errorMsg = err.message || String(err);

      if (execAttempt < MAX_RETRIES) {
        warnings.push(`Execution attempt ${execAttempt + 1} failed: ${errorMsg}`);
        try {
          const extraContext = `Execution error: ${errorMsg}\nOriginal SQL: ${sql}`;
          sql = await generateSQL(question, extraContext);

          // Re-validate the fixed SQL
          const validation = validateAdminSQL(sql, maxRows);
          if (!validation.valid) {
            warnings.push(`Fixed SQL validation failed: ${validation.error}`);
            continue;
          }
          sql = validation.sql;
          attempt++;
        } catch (genErr: any) {
          warnings.push(`Fix generation failed: ${genErr.message}`);
          continue;
        }
      } else {
        throw new Error(
          `SQL execution failed after ${attempt} generation attempts and ${execAttempt + 1} execution attempts: ${errorMsg}`,
        );
      }
    }
  }

  throw new Error('Text2SQL exhausted all retries without success');
}
