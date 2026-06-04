import 'dotenv/config';
import { PrismaClient } from '../prisma/generated/prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const rp = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const chunks = await (rp as any).knowledgeChunk.findMany({
  where: { isActive: true },
  select: { metadata: true, content: true },
  orderBy: { chunkIndex: 'asc' },
});

const seen = new Set<string>();
for (const c of chunks) {
  const m = (c.metadata || {}) as Record<string, unknown>;
  const keys = Object.keys(m).sort();
  const keySig = keys.join(', ');
  if (!seen.has(keySig)) {
    seen.add(keySig);
    console.log(`\n=== ${keys.length} keys: ${keySig} ===`);
    if (keys.length > 0) {
      console.log('Sample values:');
      for (const k of keys) {
        const v = m[k];
        const display = typeof v === 'string' && v.length > 60 ? v.substring(0, 60) + '...' : JSON.stringify(v);
        console.log(`  ${k}: ${display}`);
      }
    } else {
      console.log('  (empty metadata)');
    }
  }
}

console.log(`\nTotal: ${chunks.length} chunks, ${seen.size} distinct metadata shapes`);
await rp.$disconnect();
