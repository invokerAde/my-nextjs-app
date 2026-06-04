/**
 * Quick API latency test — check embedding and LLM response times directly.
 * Run: npx tsx scripts/diag-apis.ts
 */

import 'dotenv/config';
import OpenAI from 'openai';

async function main() {
  // 1. Test embedding API
  console.log('1. Testing embedding API...');
  const embClient = new OpenAI({
    apiKey: process.env.EMBEDDING_API_KEY,
    baseURL: process.env.EMBEDDING_BASE_URL,
    timeout: 15000,
    maxRetries: 0,
  });

  const t0 = Date.now();
  try {
    const embRes = await embClient.embeddings.create({
      model: process.env.EMBEDDING_MODEL || 'text-embedding-v4',
      input: 'How many orders in the last 3 months?',
    });
    const embMs = Date.now() - t0;
    console.log(`   ✅ ${embMs}ms, dimensions=${embRes.data[0].embedding.length}`);
  } catch (e: any) {
    console.log(`   ❌ FAILED after ${Date.now() - t0}ms: ${e.message}`);
  }

  // 2. Test LLM API (SQL generation)
  console.log('2. Testing LLM API (SQL generation)...');
  const llmClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
    timeout: 30000,
    maxRetries: 0,
  });

  const t1 = Date.now();
  try {
    const llmRes = await llmClient.chat.completions.create({
      model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a PostgreSQL expert. Return ONLY raw SQL, no markdown.' },
        { role: 'user', content: 'Write a SQL query to count orders placed in the last 3 months from admin_order_analytics_view. Use INTERVAL for time filtering.' },
      ],
      temperature: 0,
      max_tokens: 300,
    });
    const llmMs = Date.now() - t1;
    const sql = llmRes.choices[0]?.message?.content?.trim() || '(empty)';
    console.log(`   ✅ ${llmMs}ms`);
    console.log(`   SQL: ${sql.substring(0, 200)}`);
  } catch (e: any) {
    console.log(`   ❌ FAILED after ${Date.now() - t1}ms: ${e.message}`);
  }

  // 3. Test full pipeline timing (just embedding + LLM, no DB)
  const t2 = Date.now();
  console.log('\n3. Total pipeline (emb + LLM): ' + (Date.now() - t2) + 'ms estimated from above');

  console.log('\n--- Summary ---');
  console.log(`Current TEXT2SQL_TIMEOUT_MS = ${process.env.TEXT2SQL_TIMEOUT_MS || '15000 (default)'}`);
  console.log(`Current EMBEDDING_TIMEOUT_MS = ${process.env.EMBEDDING_TIMEOUT_MS || '15000 (default, commented out)'}`);
  console.log(`Current TEXT2SQL_EXEC_TIMEOUT_MS = ${process.env.TEXT2SQL_EXEC_TIMEOUT_MS || '5000 (default)'}`);

  const totalMin = (embMs || 1000) + (llmMs || 5000) + 2000; // +2s for DB + overhead
  console.log(`\nEstimated pipeline time: ~${totalMin}ms`);
  if (totalMin > 5000) {
    console.log(`⚠️ TEXT2SQL_TIMEOUT_MS (${process.env.TEXT2SQL_TIMEOUT_MS || '15000'}ms) should be >= ${Math.ceil(totalMin / 1000) * 1000}ms`);
  }
  if (totalMin > 25000) {
    console.log(`⚠️ Route maxDuration (30s) is tight for worst-case (3 retries = ${(totalMin * 3 / 1000).toFixed(0)}s)`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
