import 'dotenv/config';
import { PrismaClient } from '../prisma/generated/prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const rp = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const chunks = await (rp as any).knowledgeChunk.findMany({
  where: { isActive: true },
  select: { metadata: true, content: true },
});

let withMeta = 0;
let empty = 0;
for (const c of chunks) {
  const keys = Object.keys(c.metadata || {});
  if (keys.length > 0) {
    withMeta++;
    console.log('OK  |', keys.join(', '), '|', (c.content as string).substring(0, 60));
  } else {
    empty++;
    console.log('MISS| (empty)', '|', (c.content as string).substring(0, 60));
  }
}
console.log(`\nTotal: ${chunks.length} | with metadata: ${withMeta} | empty: ${empty}`);

await rp.$disconnect();
