/**
 * Initialize Admin Text2SQL knowledge documents.
 * Creates KnowledgeDocument/Chunk entries for DDL, field descriptions, and Few-Shot examples.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/init-admin-text2sql-knowledge.ts
 */
import 'dotenv/config';
import { VIEW_DDL, FIELD_DESCRIPTIONS, FEW_SHOT_EXAMPLES, ANALYTICS_VIEWS } from '../lib/services/admin-text2sql/knowledge';
import { indexDocument } from '../lib/services/index.service';

const SOURCE_REF = 'admin-text2sql-knowledge-v1';

async function main() {
  console.log('[init] Indexing admin Text2SQL knowledge...');

  // 1. DDL documents (one per view)
  let ddlCount = 0;
  for (const view of ANALYTICS_VIEWS) {
    const ddl = VIEW_DDL[view];
    const result = await indexDocument({
      productId: null as any,
      docType: 'sql_ddl',
      title: `DDL: ${view}`,
      content: ddl,
      sourceRef: SOURCE_REF,
      groupKey: `sql_ddl:${view}`,
    });
    if (result.action !== 'skipped') ddlCount++;
  }
  console.log(`[init] DDL docs: ${ddlCount} created/updated`);

  // 2. Field descriptions (grouped by view)
  let descCount = 0;
  const viewsWithDescriptions = [...new Set(FIELD_DESCRIPTIONS.map(f => f.view))];
  for (const view of viewsWithDescriptions) {
    const fields = FIELD_DESCRIPTIONS.filter(f => f.view === view);
    const content = fields.map(f => `${f.field}: ${f.description}`).join('\n');
    const result = await indexDocument({
      productId: null as any,
      docType: 'sql_description',
      title: `Field Descriptions: ${view}`,
      content,
      sourceRef: SOURCE_REF,
      groupKey: `sql_description:${view}`,
    });
    if (result.action !== 'skipped') descCount++;
  }
  console.log(`[init] Description docs: ${descCount} created/updated`);

  // 3. Few-Shot examples (bundled into chunks of 5)
  let exampleCount = 0;
  const BATCH_SIZE = 5;
  for (let i = 0; i < FEW_SHOT_EXAMPLES.length; i += BATCH_SIZE) {
    const batch = FEW_SHOT_EXAMPLES.slice(i, i + BATCH_SIZE);
    const content = batch
      .map((e, j) => `Example ${i + j + 1}:\nQ: ${e.question}\nSQL: ${e.sql}`)
      .join('\n\n');
    const result = await indexDocument({
      productId: null as any,
      docType: 'sql_example',
      title: `Few-Shot Examples Batch ${Math.floor(i / BATCH_SIZE) + 1}`,
      content,
      sourceRef: SOURCE_REF,
      groupKey: `sql_example:batch_${Math.floor(i / BATCH_SIZE) + 1}`,
    });
    if (result.action !== 'skipped') exampleCount++;
  }
  console.log(`[init] Few-Shot docs: ${exampleCount} created/updated`);

  console.log('[init] Done.');
}

main().catch(e => {
  console.error('[init] Fatal:', e);
  process.exit(1);
});
