/**
 * SQL Generator — LLM prompt assembly + call.
 */

import OpenAI from 'openai';
import type { RetrievedKnowledge } from './retriever';

const MODEL = process.env.TEXT2SQL_MODEL || process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const TIMEOUT_MS = Number(process.env.TEXT2SQL_TIMEOUT_MS) || 15000;

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

function buildSystemPrompt(knowledge: RetrievedKnowledge): string {
  // Order: DDL → descriptions → examples (plan-required)
  const parts = ['You are a PostgreSQL SQL generator for admin analytics.'];

  if (knowledge.ddl) parts.push(`\n## Views (DDL)\n${knowledge.ddl}`);
  if (knowledge.descriptions) parts.push(`\n## Field Descriptions\n${knowledge.descriptions}`);
  if (knowledge.examples) parts.push(`\n## Few-Shot Examples\n${knowledge.examples}`);

  parts.push(`\n## Rules
- ONLY SELECT queries on the views above.
- PostgreSQL syntax. ILIKE for text. NOW()/INTERVAL for time.
- ORDER BY for ranking/trends.
- Return ONLY raw SQL, no markdown fences.\n`);

  return parts.join('\n');
}

export async function generateSQL(
  question: string,
  knowledge: RetrievedKnowledge,
  extraContext?: string,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt(knowledge) },
    ];

    if (extraContext) {
      messages.push({
        role: 'user',
        content: `Previous attempt failed:\n${extraContext}\n\nFix the SQL. Question: ${question}`,
      });
    } else {
      messages.push({ role: 'user', content: `Question: ${question}` });
    }

    const completion = await getClient().chat.completions.create(
      { model: MODEL, messages, temperature: 0, max_tokens: 600 },
      { signal: controller.signal },
    );

    const raw = completion.choices[0]?.message?.content?.trim() || '';
    return raw.replace(/^```sql\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  } finally {
    clearTimeout(timeoutId);
  }
}
