import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();

const r = await c.query(
  `SELECT count(*)::int as total,
          count(embedding) as with_embedding,
          count(*)::int - count(embedding) as null_embedding
   FROM "KnowledgeChunk" WHERE "isActive" = true`,
);
console.log(JSON.stringify(r.rows[0]));

c.release();
await pool.end();
