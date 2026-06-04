/**
 * Apply admin analytics views using pg Pool (direct TCP connection)
 * Run: npx tsx scripts/apply-views-direct.ts
 */
import 'dotenv/config';
import pg from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const { Pool } = pg;

async function main() {
  // Construct direct (non-pooled) connection URL from the pooled DATABASE_URL
  const pooledUrl = process.env.DATABASE_URL!;
  // ep-dawn-dawn-a11mc6h1-pooler → ep-dawn-dawn-a11mc6h1
  const directUrl = pooledUrl.replace('-pooler', '');
  console.log(`Using direct connection: ${directUrl.replace(/npg_.*?@/, '***@')}`);

  const pool = new Pool({
    connectionString: directUrl,
    max: 1,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Apply the analytics views migration
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'prisma/migrations/20260605000000_admin_analytics_views/migration.sql'),
      'utf-8'
    );

    console.log('Applying analytics views...');
    await pool.query(sql);
    console.log('Done.\n');

    // Verify
    const views = ['admin_product_analytics_view','admin_order_analytics_view','admin_review_analytics_view','admin_customer_summary_view'];
    for (const v of views) {
      try {
        const r = await pool.query(`SELECT count(*)::int as c FROM ${v}`);
        console.log(`  ✅ ${v}: ${r.rows[0].c} rows`);
      } catch (e: any) {
        console.log(`  ❌ ${v}: ${e.message?.substring(0, 80)}`);
      }
    }
  } finally {
    await pool.end();
  }
}
main();
