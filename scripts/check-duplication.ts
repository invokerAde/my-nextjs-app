import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();

// 1. 取一个商品，对比 KnowledgeDocument.metadata 和 KnowledgeChunk.product_detail 的内容

// KnowledgeDocument metadata for a product_detail doc
const doc = await c.query(
  `SELECT kd."productId", kd.metadata
   FROM "KnowledgeDocument" kd
   WHERE kd."docType" = 'product_detail'
   LIMIT 1`,
);
console.log('=== KnowledgeDocument.metadata (过滤元数据) ===');
const d = doc.rows[0];
console.log('productId:', d.productId);
console.log(JSON.stringify(d.metadata, null, 2).slice(0, 600));

// 同一商品的 product_detail chunk
const chunk = await c.query(
  `SELECT kc.content, kc.metadata
   FROM "KnowledgeChunk" kc
   JOIN "KnowledgeDocument" kd ON kd.id = kc."documentId"
   WHERE kd."productId" = $1 AND kd."docType" = 'product_detail' AND kc."isActive" = true
   LIMIT 1`,
  [d.productId],
);
console.log('\n=== KnowledgeChunk.product_detail (向量/FTS 用) ===');
const ch = chunk.rows[0];
console.log('chunk metadata:', JSON.stringify(ch?.metadata, null, 2).slice(0, 400));
console.log('content preview:', ch?.content?.slice(0, 300) || '(无 product_detail chunk)');

// 2. 统计 product_detail 文档数
const count = await c.query(
  `SELECT count(*)::int as cnt FROM "KnowledgeDocument" WHERE "docType" = 'product_detail'`,
);
console.log('\n=== product_detail 文档数:', count.rows[0].cnt, '===');

c.release();
await pool.end();
