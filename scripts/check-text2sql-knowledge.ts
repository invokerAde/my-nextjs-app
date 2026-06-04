import 'dotenv/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@/prisma/generated/prisma/client';

const a = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const p = new PrismaClient({ adapter: a });

async function main() {
  const docs = await p.$queryRawUnsafe(`SELECT "docType", count(*) as cnt FROM "KnowledgeDocument" GROUP BY "docType" ORDER BY "docType"`) as any[];
  console.log('KnowledgeDocuments by docType:');
  docs.forEach((d: any) => console.log(`  ${d.docType || '(null)'}: ${d.cnt}`));

  const chunks = await p.$queryRawUnsafe(`SELECT kd."docType", count(*) as cnt, count(kc.embedding) as with_embed FROM "KnowledgeChunk" kc JOIN "KnowledgeDocument" kd ON kd.id = kc."documentId" GROUP BY kd."docType" ORDER BY kd."docType"`) as any[];
  console.log('\nKnowledgeChunks by docType (with embedding):');
  chunks.forEach((c: any) => console.log(`  ${c.docType || '(null)'}: ${c.cnt} chunks, ${c.with_embed} with embedding`));

  const embConf = process.env.EMBEDDING_API_KEY ? `EMBEDDING_API_KEY=***${process.env.EMBEDDING_API_KEY.slice(-4)}` : 'EMBEDDING_API_KEY NOT SET';
  const embModel = process.env.EMBEDDING_MODEL || 'EMBEDDING_MODEL NOT SET';
  console.log(`\nEmbedding config: ${embConf}, ${embModel}`);

  await p.$disconnect();
}
main();
