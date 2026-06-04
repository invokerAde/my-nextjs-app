/**
 * Text-to-Metadata-Filter service.
 *
 * Uses LLM (with structured JSON output) to parse a natural-language query
 * into a Filter AST.  Falls back entirely on any failure — this service MUST
 * NOT throw or block the chat pipeline.
 */

import OpenAI from 'openai';
import { METADATA_SCHEMA, type MetadataFieldSchema } from '@/lib/rag/metadata-schema';
import { type FilterAst, type FilterNode, validateAst } from '@/lib/rag/filter-ast';

const TIMEOUT_MS = Number(process.env.TEXT2METADATA_TIMEOUT_MS) || 10000;
const MODEL = process.env.OPENAI_CHAT_MODEL || 'deepseek-v4-pro';

export interface TextToMetadataResult {
  /** Cleaned query for FTS / vector search (filters stripped if possible) */
  semanticQuery: string;
  /** Validated filter AST, or null on failure */
  filterAst: FilterAst;
  /** Human-readable diagnostics */
  warnings: string[];
  /** True when LLM call failed entirely and fell back to no-filter */
  usedTotalFallback: boolean;
}

// ── Prompt builder ──

function buildSystemPrompt(): string {
  const fieldDescriptions = METADATA_SCHEMA.map(f => {
    const parts = [`  - ${f.name} (${f.type}, ${f.filterStrength})`];
    parts.push(`    ${f.description}`);
    if (f.enumValues) {
      parts.push(`    enum: [${f.enumValues.join(', ')}]`);
    }
    parts.push(`    operators: [${f.operators.join(', ')}]`);
    return parts.join('\n');
  }).join('\n');

  return `You are a query parser for an e-commerce product metadata filter system.

Your job: extract structured filter conditions AND a cleaned semantic query from user input.

## Field schema
${fieldDescriptions}

## Rules
- Output ONLY valid JSON, no explanation.
- NEVER generate SQL.
- For multi-value enum fields (string[]), use "in" operator with an array — do NOT generate OR trees.
  Example: user asks for "春秋两季" → { "field": "season", "op": "in", "value": ["春秋"] }
  Example: user asks for "上班通勤都能穿" → { "field": "scene", "op": "in", "value": ["上班", "通勤"] }
- For numeric fields, use gt/gte/lt/lte/between with number values.
- For "以内/以下/不超过", use "lte".
- For "以上/及以上/不低于", use "gte".
- For "之间/到", use "between" with [min, max].
- If the user asks about stock ("有货/有库存/现货"), add { "field": "stock", "op": "gt", "value": 0 }.
- For category matching, use "contains" with the category keyword.
- "semanticQuery" should be the user's original query with filter-related words removed or simplified,
  used for FTS/vector search. Keep natural language that describes what the user wants.
- If no filter conditions apply, return empty "conditions" array.

## Output format
{
  "semanticQuery": "cleaned natural language query for vector search",
  "conditions": [
    { "field": "price", "op": "lte", "value": 100 },
    { "field": "material", "op": "eq", "value": "纯棉" }
  ],
  "warnings": []
}

If the conditions array has 2+ entries, wrap them in an "and" node:
{
  "semanticQuery": "...",
  "filter": {
    "type": "and",
    "children": [
      { "field": "price", "op": "lte", "value": 100 },
      { "field": "material", "op": "eq", "value": "纯棉" }
    ]
  },
  "warnings": []
}

If only 1 condition, use it directly (no and wrapper):
{ "semanticQuery": "...", "filter": { "field": "price", "op": "lte", "value": 100 }, "warnings": [] }`;
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

// ── Response types for parsing ──

interface LLMFilterCondition {
  field: string;
  op: string;
  value: unknown;
}

interface LLMFilterNode {
  type?: 'and' | 'or' | 'not';
  children?: LLMFilterNode[];
  child?: LLMFilterNode;
  field?: string;
  op?: string;
  value?: unknown;
}

interface LLMResponse {
  semanticQuery?: string;
  filter?: LLMFilterNode;
  conditions?: LLMFilterCondition[];
  warnings?: string[];
}

// ── Main export ──

export async function textToMetadataFilter(query: string): Promise<TextToMetadataResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const completion = await getClient().chat.completions.create(
      {
        model: MODEL,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: `Parse: ${query}\nRespond with ONLY the JSON object, no markdown fences.` },
        ],
        temperature: 0,
        max_tokens: 600,
      },
      { signal: controller.signal },
    );

    const raw = completion.choices[0]?.message?.content?.trim() || '';
    const parsed = JSON.parse(raw) as LLMResponse;

    // Build AST from LLM response
    let filterAst: FilterAst = null;
    const warnings: string[] = parsed.warnings || [];

    if (parsed.filter) {
      filterAst = convertLLMNode(parsed.filter);
    } else if (parsed.conditions && parsed.conditions.length > 0) {
      if (parsed.conditions.length === 1) {
        filterAst = convertLLMCondition(parsed.conditions[0]);
      } else {
        filterAst = {
          type: 'and',
          children: parsed.conditions.map(convertLLMCondition),
        };
      }
    }

    // Validate
    if (filterAst) {
      const validation = validateAst(filterAst);
      if (!validation.valid) {
        const detail = validation.errors.map(e => e.message).join('; ');
        console.warn('[textToMetadataFilter] AST validation failed:', detail);
        return {
          semanticQuery: parsed.semanticQuery || query,
          filterAst: null,
          warnings: [...warnings, `AST validation failed: ${detail}`],
          usedTotalFallback: true,
        };
      }
    }

    return {
      semanticQuery: parsed.semanticQuery || query,
      filterAst,
      warnings,
      usedTotalFallback: false,
    };
  } catch (err: any) {
    console.warn('[textToMetadataFilter] LLM parser failed:', err.message || err);
    // Regex fallback — extract basic numeric/stock/category conditions
    const regexAst = regexFallback(query);
    return {
      semanticQuery: query,
      filterAst: regexAst,
      warnings: regexAst
        ? [`LLM parser failed (${err.message}), using regex fallback`]
        : [`LLM parser failed: ${err.message || 'unknown error'}`],
      usedTotalFallback: regexAst === null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Regex fallback ──

function regexFallback(query: string): FilterAst {
  const conditions: FilterNode[] = [];

  // Price: "N元以内/以下/不超过/N以下", "N以上", "N-M元/美元"
  const priceUnder = query.match(/(\d+)\s*(?:元|美元|美金|块)?\s*(?:以内|以下|不超过|以下)/);
  const priceAbove = query.match(/(\d+)\s*(?:元|美元|美金|块)?\s*(?:以上|及以上|不低于)/);
  const priceRange = query.match(/(\d+)\s*[-到至]\s*(\d+)\s*(?:元|美元|美金|块)?/);
  if (priceUnder) {
    conditions.push({ field: 'price', op: 'lte', value: Number(priceUnder[1]) });
  }
  if (priceAbove) {
    conditions.push({ field: 'price', op: 'gte', value: Number(priceAbove[1]) });
  }
  if (priceRange) {
    conditions.push({ field: 'price', op: 'between', value: [Number(priceRange[1]), Number(priceRange[2])] });
  }

  // Rating: "评分N分以上"
  const rating = query.match(/评分?\s*(\d(?:\.\d)?)\s*(?:分|星)?\s*(?:以上|及以上)/);
  if (rating) {
    conditions.push({ field: 'rating', op: 'gte', value: Number(rating[1]) });
  }

  // Stock: "有库存/有货/现货"
  if (/有库存|有货|现货/.test(query)) {
    conditions.push({ field: 'stock', op: 'gt', value: 0 });
  }

  // Category
  const cat = query.match(/(衬衫|T恤|外套|裤子|裙|连衣裙|鞋子|卫衣|夹克|风衣|毛衣|POLO|短裤|羽绒服|棉服|西服|马甲)/);
  if (cat) {
    conditions.push({ field: 'category', op: 'contains', value: cat[1] });
  }

  // Material
  const mat = query.match(/(纯棉|棉质|棉麻|真丝|羊毛|羊绒|真皮|牛仔|亚麻|莫代尔|涤纶|棉涤)/);
  if (mat) {
    conditions.push({ field: 'material', op: 'eq', value: mat[1] });
  }

  if (conditions.length === 0) return null;
  if (conditions.length === 1) return conditions[0];
  return { type: 'and', children: conditions };
}

function convertLLMCondition(c: LLMFilterCondition): FilterNode {
  return {
    field: c.field,
    op: c.op as any,
    value: c.value,
  };
}

function convertLLMNode(node: LLMFilterNode): FilterNode | null {
  if (node.field) {
    return convertLLMCondition(node as LLMFilterCondition);
  }
  if (node.type === 'and' || node.type === 'or') {
    const children = (node.children || [])
      .map(convertLLMNode)
      .filter((n): n is FilterNode => n !== null);
    return { type: node.type, children };
  }
  if (node.type === 'not' && node.child) {
    const child = convertLLMNode(node.child);
    return child ? { type: 'not', child } : null;
  }
  return null;
}
