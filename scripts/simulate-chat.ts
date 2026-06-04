/**
 * Simulate the chat route's retrieval → context assembly pipeline.
 * Shows exactly what the LLM would see in its system prompt.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/simulate-chat.ts
 */
import 'dotenv/config';

async function main() {
  const queries = ['90以下的衣服', '纯棉衬衫', '透气性好的夏季衣服'];

  for (const query of queries) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Query: "${query}"`);
    console.log('='.repeat(60));

    const { retrieve } = await import('../lib/services/retrieval.service');
    const retrievalResult = await retrieve(query);

    console.log(`\nHits: ${retrievalResult.hits.length}`);
    console.log(`Sources: ${retrievalResult.usedSources.join(', ')}`);
    console.log(`Confidence: ${retrievalResult.confidence}`);
    console.log(`Warnings: ${retrievalResult.warnings.join('; ')}`);

    // Replicate chat route context assembly
    const parts: string[] = ['\n\n--- 知识库检索结果 ---'];
    parts.push('\n[商品检索结果]');
    for (const hit of retrievalResult.hits.slice(0, 5)) {
      const meta = (hit.metadata || {}) as Record<string, unknown>;
      const fields: string[] = [];
      if (meta.name) fields.push(`商品: ${meta.name}`);
      if (meta.brand) fields.push(`品牌: ${meta.brand}`);
      if (meta.category) fields.push(`类目: ${meta.category}`);
      if (meta.price != null) fields.push(`价格: ¥${meta.price}`);
      if (meta.rating != null) fields.push(`评分: ${meta.rating}/5`);
      if (meta.numReviews != null) fields.push(`${meta.numReviews}条评价`);
      if (meta.stock != null) fields.push(`库存: ${meta.stock}件`);
      if (meta.material) fields.push(`材质: ${meta.material}`);
      if (meta.fit) fields.push(`版型: ${meta.fit}`);
      const metaLine = fields.length > 0 ? ` | ${fields.join(' | ')}` : '';
      console.log(`\n  Hit:${metaLine}`);
      console.log(`  Content preview: ${(hit.content || '').substring(0, 100)}`);
    }

    console.log(`\n  --- Context that LLM receives (first 400 chars) ---`);
    const context = parts.join('\n');
    console.log(context.substring(0, 400));
  }

  console.log('\nDone.');
}

main().catch(console.error);
