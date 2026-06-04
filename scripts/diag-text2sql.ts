/**
 * Diagnostic script: runs the Text2SQL pipeline step by step with timing.
 * Run: npx tsx scripts/diag-text2sql.ts
 */

import 'dotenv/config';

async function main() {
  const question = 'How many orders were placed in the last 3 months?';
  console.log(`Testing Text2SQL pipeline with: "${question}"\n`);

  // ── Step 1: validateQuestion ──
  console.time('1. validateQuestion');
  const { validateQuestion } = await import('@/lib/services/admin-text2sql/validator');
  const qCheck = validateQuestion(question);
  console.timeEnd('1. validateQuestion');
  console.log(`   valid=${qCheck.valid}, error=${qCheck.error || 'none'}`);

  // ── Step 2: retrieveKnowledge ──
  console.time('2. retrieveKnowledge');
  const { retrieveKnowledge } = await import('@/lib/services/admin-text2sql/retriever');
  let knowledge;
  try {
    knowledge = await retrieveKnowledge(question);
    console.timeEnd('2. retrieveKnowledge');
    console.log(`   ddl=${knowledge.ddl.length} chars, desc=${knowledge.descriptions.length} chars, examples=${knowledge.examples.length} chars`);
  } catch (e: any) {
    console.timeEnd('2. retrieveKnowledge');
    console.log(`   FAILED: ${e.message}`);
  }

  if (!knowledge) { console.log('\nAborting - retriever failed'); return; }

  // ── Step 3: generateSQL ──
  console.time('3. generateSQL');
  const { generateSQL } = await import('@/lib/services/admin-text2sql/generator');
  let sql;
  try {
    sql = await generateSQL(question, knowledge);
    console.timeEnd('3. generateSQL');
    console.log(`   SQL (${sql.length} chars): ${sql.substring(0, 200)}...`);
  } catch (e: any) {
    console.timeEnd('3. generateSQL');
    console.log(`   FAILED: ${e.message}`);
    return;
  }

  // ── Step 4: validateAdminSQL ──
  console.time('4. validateAdminSQL');
  const { validateAdminSQL } = await import('@/lib/services/admin-text2sql/validator');
  const validation = validateAdminSQL(sql, 100);
  console.timeEnd('4. validateAdminSQL');
  console.log(`   valid=${validation.valid}, error=${validation.error || 'none'}`);

  if (!validation.valid) { console.log('\nAborting - validation failed'); return; }

  // ── Step 5: executeSQL (dry run mode - just check executor readiness) ──
  console.time('5. executeSQL');
  const { executeSQL } = await import('@/lib/services/admin-text2sql/executor');
  try {
    const result = await executeSQL(validation.sql, 10);
    console.timeEnd('5. executeSQL');
    console.log(`   columns=${result.columns.join(', ')}, rows=${result.rows.length}, ms=${result.ms}`);
  } catch (e: any) {
    console.timeEnd('5. executeSQL');
    console.log(`   FAILED: ${e.message}`);
  }

  // ── Step 6: Full agent run ──
  console.log('\n--- Full agent run ---');
  console.time('6. runText2SQL');
  const { runText2SQL } = await import('@/lib/services/admin-text2sql/agent');
  try {
    const result = await runText2SQL({ question, maxRows: 10 });
    console.timeEnd('6. runText2SQL');
    console.log(`   SQL: ${result.sql.substring(0, 100)}...`);
    console.log(`   columns: ${result.columns.join(', ')}`);
    console.log(`   rowCount: ${result.rowCount}`);
    console.log(`   attempts: ${result.attempts}, executionMs: ${result.executionMs}`);
    console.log(`   warnings: ${result.warnings.length > 0 ? result.warnings.join('; ') : 'none'}`);
    console.log(`   knowledgeSources: ${result.knowledgeSources.join(', ')}`);
  } catch (e: any) {
    console.timeEnd('6. runText2SQL');
    console.log(`   FAILED: ${e.message}`);
    console.log(`   detail: ${e.detail || 'none'}`);
    console.log(`   attempts: ${e.attempts || 0}`);
    console.log(`   warnings: ${JSON.stringify(e.warnings || [])}`);
  }

  console.log('\nDone.');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
