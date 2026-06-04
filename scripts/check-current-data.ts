import 'dotenv/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@/prisma/generated/prisma/client';

const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const r = await p.$queryRawUnsafe(`
    SELECT 'Product' as t, count(*)::int as c FROM "Product"
    UNION ALL SELECT 'User', count(*)::int FROM "User"
    UNION ALL SELECT 'Order', count(*)::int FROM "Order"
    UNION ALL SELECT 'OrderItem', count(*)::int FROM "OrderItem"
    UNION ALL SELECT 'Review', count(*)::int FROM "Review"
    UNION ALL SELECT 'Cart', count(*)::int FROM "Cart"
  `) as any[];
  r.forEach((row: any) => console.log(`${row.t}: ${row.c}`));

  // Check product categories
  const cats = await p.$queryRawUnsafe(`SELECT category, count(*)::int as c FROM "Product" GROUP BY category ORDER BY c DESC`) as any[];
  console.log('\nCategories:');
  cats.forEach((row: any) => console.log(`  ${row.category}: ${row.c}`));

  // Check order date range
  const orders = await p.$queryRawUnsafe(`SELECT min("createdAt") as min_d, max("createdAt") as max_d, count(*)::int as c FROM "Order"`) as any[];
  console.log(`\nOrders: ${orders[0].c} (${orders[0].min_d} ~ ${orders[0].max_d})`);

  // Check paid/delivered breakdown
  const status = await p.$queryRawUnsafe(`SELECT "isPaid", "isDelivered", count(*)::int as c FROM "Order" GROUP BY "isPaid", "isDelivered" ORDER BY "isPaid", "isDelivered"`) as any[];
  console.log('\nOrder status:');
  status.forEach((row: any) => console.log(`  isPaid=${row.isPaid} isDelivered=${row.isDelivered}: ${row.c}`));

  await p.$disconnect();
}
main();
