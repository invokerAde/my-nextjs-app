import 'dotenv/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@/prisma/generated/prisma/client';

const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const views = ['admin_product_analytics_view','admin_order_analytics_view','admin_review_analytics_view','admin_customer_summary_view','product_search_view','active_knowledge_chunk_view'];
  for (const v of views) {
    try {
      await p.$queryRawUnsafe(`SELECT 1 FROM ${v} LIMIT 0`);
      console.log(`  ✅ ${v}`);
    } catch {
      console.log(`  ❌ ${v} MISSING`);
    }
  }
  await p.$disconnect();
}
main();
