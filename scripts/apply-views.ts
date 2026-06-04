/**
 * Apply admin analytics views directly (bypassing Prisma migrate)
 * Run: npx tsx scripts/apply-views.ts
 */
import 'dotenv/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@/prisma/generated/prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  // Read the migration SQL for the analytics views
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'prisma/migrations/20260605000000_admin_analytics_views/migration.sql'),
    'utf-8'
  );

  console.log('Applying analytics views migration...');
  await p.$executeRawUnsafe(sql);
  console.log('Done. Verifying...');

  const views = ['admin_product_analytics_view','admin_order_analytics_view','admin_review_analytics_view','admin_customer_summary_view'];
  for (const v of views) {
    try {
      const r = await p.$queryRawUnsafe(`SELECT count(*)::int as c FROM ${v}`) as any[];
      console.log(`  ✅ ${v}: ${r[0].c} rows`);
    } catch (e: any) {
      console.log(`  ❌ ${v}: ${e.message?.substring(0, 80)}`);
    }
  }
  await p.$disconnect();
}
main();
