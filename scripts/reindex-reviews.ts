/**
 * Re-index all review chunks with proper product metadata.
 * Usage: npx tsx --tsconfig tsconfig.json scripts/reindex-reviews.ts
 */
import 'dotenv/config';
import { PrismaClient } from '../prisma/generated/prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const rp = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const products = await rp.product.findMany({ select: { id: true, name: true } });
console.log(`Re-indexing reviews for ${products.length} products...`);

for (const p of products) {
  // Re-run review ingestion to create chunks with metadata
  const { ingestProductReviews } = await import('../lib/services/review-ingestion.service');
  const result = await ingestProductReviews(p.id);
  console.log(`  ${p.name}: ${result.path} — ${result.message}`);
}

// Verify
const chunks = await (rp as any).knowledgeChunk.count({
  where: { isActive: true },
});
const withMeta = await (rp as any).knowledgeChunk.count({
  where: {
    isActive: true,
    NOT: { metadata: {} },
  },
});
console.log(`\nDone. Active chunks: ${chunks} | with metadata: ${withMeta}`);

await rp.$disconnect();
