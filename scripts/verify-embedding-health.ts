import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();

// 1. 维度检查
const dims = await c.query(
  `SELECT id, vector_dims(embedding) as dims, length(content) as content_len
   FROM "KnowledgeChunk" WHERE "isActive" = true AND embedding IS NOT NULL LIMIT 3`,
);
console.log('1. 维度:', JSON.stringify(dims.rows));

// 2. 向量搜索功能测试
const hasVector = await c.query(
  `SELECT count(*)::int as cnt
   FROM "KnowledgeChunk" WHERE "isActive" = true AND embedding IS NOT NULL`,
);
console.log('2. 可搜索向量数:', hasVector.rows[0].cnt);

// 3. 实际跑一次向量搜索看是否返回结果
const search = await c.query(
  `SELECT kc.id, kc."chunkIndex",
          1 - (kc.embedding <=> (SELECT embedding FROM "KnowledgeChunk" WHERE "isActive" = true AND embedding IS NOT NULL LIMIT 1)) AS similarity
   FROM active_knowledge_chunk_view kc
   WHERE kc.embedding IS NOT NULL
   ORDER BY kc.embedding <=> (SELECT embedding FROM "KnowledgeChunk" WHERE "isActive" = true AND embedding IS NOT NULL LIMIT 1)
   LIMIT 3`,
);
console.log('3. 向量搜索测试:', JSON.stringify(search.rows));

c.release();
await pool.end();
