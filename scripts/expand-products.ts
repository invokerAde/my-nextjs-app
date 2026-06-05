import 'dotenv/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@/prisma/generated/prisma/client';
import sampleData from '../db/sample-data';

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Expanding product catalog...\n');

  // Fetch existing slugs to avoid duplicate inserts
  const existing = await prisma.product.findMany({ select: { slug: true } });
  const existingSlugs = new Set(existing.map((p) => p.slug));

  const newProducts = sampleData.products.filter((p) => !existingSlugs.has(p.slug));

  if (newProducts.length === 0) {
    console.log('All products already exist. Nothing to insert.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${existingSlugs.size} existing products.`);
  console.log(`Inserting ${newProducts.length} new products:\n`);

  for (const p of newProducts) {
    await prisma.product.create({ data: p as any });
    console.log(`  [${p.category}] ${p.name} — $${p.price} (${p.slug})`);
  }

  const total = await prisma.product.count();
  console.log(`\nDone. Total products in database: ${total}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Expansion failed:', err);
  process.exit(1);
});
