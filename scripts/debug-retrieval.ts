/**
 * Retrieval pipeline diagnostic script.
 * Usage: npx tsx --tsconfig tsconfig.json scripts/debug-retrieval.ts
 */
import 'dotenv/config';

// Override timeout for debugging
process.env.TEXT2METADATA_TIMEOUT_MS = '10000';

async function main() {
  const query = '90美元以下的衣服';
  console.log('[debug] Query:', query);

  // ── Step 1: LLM parse ──
  console.log('\n── Step 1: textToMetadataFilter ──');
  const { textToMetadataFilter } = await import('../lib/services/text-to-metadata-filter.service');
  const parseResult = await textToMetadataFilter(query);
  console.log('  semanticQuery:', parseResult.semanticQuery);
  console.log('  filterAst:', JSON.stringify(parseResult.filterAst, null, 2));
  console.log('  warnings:', parseResult.warnings);
  console.log('  usedTotalFallback:', parseResult.usedTotalFallback);

  // ── Step 2: Translate ──
  console.log('\n── Step 2: translateAst ──');
  if (parseResult.filterAst) {
    const { translateAst } = await import('../lib/services/filter-translator.service');
    const translation = translateAst(parseResult.filterAst);
    console.log('  SQL clause:', translation.clause.substring(0, 200));
    console.log('  params:', translation.params);
  } else {
    console.log('  No filter AST — skipping translation');
  }

  // ── Step 3: Intent ──
  console.log('\n── Step 3: classifyIntent ──');
  const { classifyIntent } = await import('../lib/services/intent.service');
  const intent = classifyIntent(query);
  console.log('  intents:', intent.intents);
  console.log('  isTimeSensitive:', intent.isTimeSensitive);

  // ── Step 4: Full retrieval ──
  console.log('\n── Step 4: retrieve() ──');
  const { retrieve } = await import('../lib/services/retrieval.service');
  const result = await retrieve(query);
  console.log('  hits:', result.hits.length);
  console.log('  usedSources:', result.usedSources);
  console.log('  confidence:', result.confidence);
  console.log('  warnings:', result.warnings);
  if (result.hits.length > 0) {
    console.log('  Top hit content:', result.hits[0].content?.substring(0, 150));
    console.log('  Top hit metadata:', JSON.stringify(result.hits[0].metadata, null, 2).substring(0, 300));
  }

  // ── Step 5: Raw DB check ──
  console.log('\n── Step 5: Raw product count ──');
  try {
    const { PrismaClient } = await import('../prisma/generated/prisma/client');
    const { PrismaNeon } = await import('@prisma/adapter-neon');
    const rp = new PrismaClient({
      adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
    });
    const count = await (rp as any).knowledgeChunk.count({ where: { isActive: true } });
    console.log('  Active chunks:', count);
    const productCount = await (rp as any).product.count();
    console.log('  Products:', productCount);
    const docCount = await (rp as any).knowledgeDocument.count({ where: { docType: 'product_detail' } });
    console.log('  product_detail docs:', docCount);
    await rp.$disconnect();
  } catch (err: any) {
    console.log('  DB check failed:', err.message);
  }

  console.log('\n[debug] Done.');
}

main().catch(e => {
  console.error('[debug] Fatal:', e);
  process.exit(1);
});
