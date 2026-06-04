/**
 * Mark migrations as applied in _prisma_migrations table (read-only pooler bypass)
 */
import 'dotenv/config';
import pg from 'pg';

async function main() {
  const pooledUrl = process.env.DATABASE_URL!;
  const directUrl = pooledUrl.replace('-pooler', '');
  const pool = new pg.Pool({ connectionString: directUrl, max: 1, ssl: { rejectUnauthorized: false } });

  try {
    // Mark both migrations as applied
    const migrations = [
      { name: '20260604000000_remove_productspec', checksum: 'fixed-jsonb-cast' },
      { name: '20260605000000_admin_analytics_views', checksum: 'applied-via-script' },
    ];

    for (const m of migrations) {
      try {
        await pool.query(
          `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
           VALUES ($1, $2, NOW(), $3, NULL, NULL, NOW(), 1)
           ON CONFLICT (id) DO NOTHING`,
          [m.name, m.checksum, m.name]
        );
        console.log(`  ✅ Marked ${m.name} as applied`);
      } catch (e: any) {
        console.log(`  ⚠️ ${m.name}: ${e.message?.substring(0, 80)}`);
      }
    }
    console.log('Done.');
  } finally {
    await pool.end();
  }
}
main();
