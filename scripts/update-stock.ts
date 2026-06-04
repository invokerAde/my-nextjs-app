import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  console.log('[update-stock] connected');

  const before = await client.query('SELECT id, name, stock FROM "Product" LIMIT 2');
  console.log('[update-stock] before:', JSON.stringify(before.rows));

  const result = await client.query('UPDATE "Product" SET stock = 99');
  console.log('[update-stock] rows updated:', result.rowCount);

  const after = await client.query('SELECT id, name, stock FROM "Product" LIMIT 2');
  console.log('[update-stock] after:', JSON.stringify(after.rows));

  const total = await client.query('SELECT count(*)::int as cnt FROM "Product"');
  console.log('[update-stock] total products:', total.rows[0].cnt);

  client.release();
  await pool.end();
  console.log('[update-stock] done');
}

main().catch((e) => {
  console.error('[update-stock] error:', e.message);
  process.exit(1);
});
