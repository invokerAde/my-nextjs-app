import 'dotenv/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@/prisma/generated/prisma/client';

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const p = new PrismaClient({ adapter });

async function main() {
  const views = ['admin_product_analytics_view', 'admin_order_analytics_view', 'admin_review_analytics_view', 'admin_customer_summary_view'];
  for (const v of views) {
    const result = await p.$queryRawUnsafe(`SELECT count(*) as cnt FROM ${v}`) as any[];
    console.log(`${v}: ${result[0].cnt} rows`);
  }
  const cats = await p.$queryRawUnsafe(`SELECT category, count(*) as cnt FROM admin_product_analytics_view GROUP BY category ORDER BY cnt DESC`) as any[];
  console.log('\nCategories:');
  cats.forEach((c: any) => console.log(`  ${c.category}: ${c.cnt} products`));

  const orders = await p.$queryRawUnsafe(`SELECT is_paid, count(*) as cnt FROM admin_order_analytics_view GROUP BY is_paid`) as any[];
  console.log('\nOrders:');
  orders.forEach((o: any) => console.log(`  is_paid=${o.is_paid}: ${o.cnt} orders`));

  await p.$disconnect();
}
main();
