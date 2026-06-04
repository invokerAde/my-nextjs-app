import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();

// 1. chunk.metadata JSON 字段内容
const m = await c.query(
  `SELECT id, "chunkIndex", metadata, "tokenCount"
   FROM "KnowledgeChunk" WHERE "isActive" = true LIMIT 3`,
);
console.log('=== chunk.metadata JSON ===');
for (const r of m.rows) {
  console.log(`  id=${r.id.slice(0,8)}... idx=${r.chunkIndex} tokens=${r.tokenCount} metadata=${JSON.stringify(r.metadata)}`);
}

// 2. 关联的 KnowledgeDocument 元数据
const d = await c.query(
  `SELECT kd."docType", kd.title, kd.version, kd."sourceRef", kd."productId",
          count(*) as chunk_count
   FROM "KnowledgeChunk" kc
   JOIN "KnowledgeDocument" kd ON kd.id = kc."documentId"
   WHERE kc."isActive" = true
   GROUP BY kd."docType", kd.title, kd.version, kd."sourceRef", kd."productId"
   ORDER BY kd."docType"`,
);
console.log('\n=== KnowledgeDocument 元数据 ===');
for (const r of d.rows) {
  console.log(`  docType=${r.docType} v${r.version} productId=${r.productId?.slice(0,8) || 'NULL'} sourceRef=${r.sourceRef?.slice(0,25) || 'NULL'} chunks=${r.chunk_count} title=${r.title?.slice(0,50)}`);
}

// 3. 视图实际提供的字段
console.log('\n=== active_knowledge_chunk_view 可用字段 ===');
const v = await c.query(`SELECT * FROM active_knowledge_chunk_view LIMIT 0`);
console.log('  columns:', v.fields.map(f => f.name).join(', '));

c.release();
await pool.end();
