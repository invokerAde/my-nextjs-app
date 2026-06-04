/**
 * Text2SQL service — compat re-export layer.
 *
 * Validation is in lib/services/text2sql/validate.ts  (pure, test-safe).
 * Execution is in lib/services/text2sql/execute.ts   (Prisma-dependent).
 * The LLM generation + full pipeline remains here for backward compat.
 *
 * ⚠️ AI 导购链路已不再使用本服务。保留供其他模块调用。
 */

import OpenAI from 'openai';
import { validateSQL, addRowLimit } from '@/lib/services/text2sql/validate';
import { executeSQL } from '@/lib/services/text2sql/execute';

// Re-export for backward compatibility
export { validateSQL, addRowLimit, executeSQL };

const TIMEOUT_MS = Number(process.env.TEXT2SQL_TIMEOUT_MS) || 5000;
const MAX_ROWS = Number(process.env.TEXT2SQL_MAX_ROWS) || 50;

const ALLOWED_TABLES = ['product_search_view'];

export interface Text2SQLResult {
  success: boolean;
  rows?: Record<string, unknown>[];
  sql?: string;
  error?: string;
}

export const SYSTEM_PROMPT = `You are a SQL query generator for an e-commerce product database.
Rules:
- ONLY SELECT queries are allowed.
- ONLY query the "product_search_view" view.
- Use ILIKE for text search on specs_json column.
- Price and rating are numeric, use >=, <=, BETWEEN.
- Always include a LIMIT clause.
- Return only the raw SQL, no explanation.`;

export const FEW_SHOT_EXAMPLES = [
  { role: 'user' as const, content: 'Query: 100元以内棉质长袖衬衫有什么推荐？\nSQL:' },
  { role: 'assistant' as const, content: `SELECT id, name, slug, category, brand, price, rating, "numReviews", stock
FROM product_search_view
WHERE price <= 100 AND specs_json ILIKE '%棉%' AND specs_json ILIKE '%长袖%' AND category ILIKE '%衬衫%' AND stock > 0
ORDER BY rating DESC LIMIT 20` },
  { role: 'user' as const, content: 'Query: 评分4分以上的夏季透气连衣裙\nSQL:' },
  { role: 'assistant' as const, content: `SELECT id, name, slug, category, brand, price, rating, "numReviews", stock
FROM product_search_view
WHERE rating >= 4 AND specs_json ILIKE '%透气%' AND category ILIKE '%裙%' AND stock > 0
ORDER BY rating DESC, price ASC LIMIT 20` },
  { role: 'user' as const, content: 'Query: 500元以内真皮材质评分最高的鞋子\nSQL:' },
  { role: 'assistant' as const, content: `SELECT id, name, slug, category, brand, price, rating, "numReviews", stock
FROM product_search_view
WHERE price <= 500 AND specs_json ILIKE '%真皮%' AND category ILIKE '%鞋%' AND stock > 0
ORDER BY rating DESC LIMIT 20` },
  { role: 'user' as const, content: 'Query: 适合上班穿的修身版型外套，黑色的\nSQL:' },
  { role: 'assistant' as const, content: `SELECT id, name, slug, category, brand, price, rating, "numReviews", stock
FROM product_search_view
WHERE specs_json ILIKE '%上班%' AND specs_json ILIKE '%修身%' AND specs_json ILIKE '%黑%' AND category ILIKE '%外套%' AND stock > 0
ORDER BY rating DESC LIMIT 20` },
  { role: 'user' as const, content: 'Query: 有没有棉质圆领短袖T恤，50元以内\nSQL:' },
  { role: 'assistant' as const, content: `SELECT id, name, slug, category, brand, price, rating, "numReviews", stock
FROM product_search_view
WHERE price <= 50 AND specs_json ILIKE '%棉%' AND specs_json ILIKE '%圆领%' AND specs_json ILIKE '%短袖%' AND category ILIKE '%T恤%' AND stock > 0
ORDER BY price ASC LIMIT 20` },
];

let clientCache: OpenAI | null = null;
function getClient(): OpenAI {
  if (!clientCache) {
    const baseURL = process.env.OPENAI_BASE_URL;
    clientCache = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      ...(baseURL ? { baseURL } : {}),
      timeout: TIMEOUT_MS,
      maxRetries: 1,
    });
  }
  return clientCache;
}

export async function textToSQL(query: string): Promise<Text2SQLResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const completion = await getClient().chat.completions.create(
      {
        model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...FEW_SHOT_EXAMPLES,
          { role: 'user', content: `Query: ${query}\nSQL:` },
        ],
        temperature: 0,
        max_tokens: 300,
      },
      { signal: controller.signal },
    );

    const sql = completion.choices[0]?.message?.content?.trim() || '';

    if (!validateSQL(sql)) {
      return { success: false, error: 'Generated SQL failed validation', sql };
    }

    return { success: true, sql: addRowLimit(sql) };
  } catch (err: any) {
    if (err.name === 'AbortError') return { success: false, error: 'Text2SQL timeout' };
    return { success: false, error: err.message || 'Text2SQL failed' };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function textToSQLAndExecute(query: string): Promise<Text2SQLResult> {
  const result = await textToSQL(query);
  if (!result.success || !result.sql) return result;

  try {
    const rows = await executeSQL(result.sql);
    return { success: true, sql: result.sql, rows };
  } catch (err: any) {
    return { success: false, sql: result.sql, error: `SQL execution failed: ${err.message}` };
  }
}
