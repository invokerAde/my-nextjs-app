/**
 * Test embedding service and LLM with proper TLS handling.
 * Run: npx tsx scripts/diag-embedding.ts
 */
import 'dotenv/config';

async function main() {
  // 1. Test embedding via the actual service
  console.log('1. Testing embedding via actual service...');
  const t0 = Date.now();
  try {
    const { generateEmbedding, isEmbeddingConfigured } = await import('@/lib/services/embedding.service');
    console.log(`   isEmbeddingConfigured=${isEmbeddingConfigured()}`);
    const emb = await generateEmbedding('How many orders in the last 3 months?');
    console.log(`   ✅ ${Date.now() - t0}ms, dimensions=${emb.length}`);
  } catch (e: any) {
    console.log(`   ❌ FAILED after ${Date.now() - t0}ms: ${e.message}`);
  }

  // 2. Test Text2SQL knowledge retriever
  console.log('\n2. Testing retriever...');
  const t1 = Date.now();
  try {
    const { retrieveKnowledge } = await import('@/lib/services/admin-text2sql/retriever');
    const knowledge = await retrieveKnowledge('How many orders in the last 3 months?');
    console.log(`   ✅ ${Date.now() - t1}ms`);
    console.log(`   ddl=${knowledge.ddl.length} chars, desc=${knowledge.descriptions.length} chars, examples=${knowledge.examples.length} chars`);
  } catch (e: any) {
    console.log(`   ❌ FAILED after ${Date.now() - t1}ms: ${e.message}`);
  }

  // 3. Test full agent with dry run
  console.log('\n3. Testing Text2SQL agent (dryRun=true)...');
  const t2 = Date.now();
  try {
    const { runText2SQL } = await import('@/lib/services/admin-text2sql/agent');
    const result = await runText2SQL({
      question: 'How many orders are there?',
      dryRun: true,
    });
    console.log(`   ✅ ${Date.now() - t2}ms`);
    console.log(`   SQL: ${result.sql.substring(0, 300)}`);
    console.log(`   attempts: ${result.attempts}, warnings: ${result.warnings.join(', ') || 'none'}`);
    console.log(`   knowledgeSources: ${result.knowledgeSources.join(', ')}`);
  } catch (e: any) {
    console.log(`   ❌ FAILED after ${Date.now() - t2}ms`);
    console.log(`   Error: ${e.message}`);
    console.log(`   Detail: ${e.detail || 'none'}`);
    console.log(`   Attempts: ${e.attempts || 0}`);
    console.log(`   Warnings: ${JSON.stringify(e.warnings || [])}`);
  }

  // 4. Test full agent with real execution
  console.log('\n4. Testing Text2SQL agent (full execution)...');
  const t3 = Date.now();
  try {
    const { runText2SQL } = await import('@/lib/services/admin-text2sql/agent');
    const result = await runText2SQL({
      question: 'How many orders are there?',
      maxRows: 10,
    });
    console.log(`   ✅ ${Date.now() - t3}ms`);
    console.log(`   SQL: ${result.sql.substring(0, 300)}`);
    console.log(`   columns: [${result.columns.join(', ')}]`);
    console.log(`   rows: ${JSON.stringify(result.rows.slice(0, 3))}`);
    console.log(`   rowCount: ${result.rowCount}, attempts: ${result.attempts}, executionMs: ${result.executionMs}`);
  } catch (e: any) {
    console.log(`   ❌ FAILED after ${Date.now() - t3}ms`);
    console.log(`   Error: ${e.message}`);
    console.log(`   Detail: ${e.detail || 'none'}`);
    console.log(`   SQL (from error): ${(e.sql || '').substring(0, 300)}`);
    console.log(`   Attempts: ${e.attempts || 0}`);
    console.log(`   Warnings: ${JSON.stringify(e.warnings || [])}`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
