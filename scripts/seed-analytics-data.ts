/**
 * Seed script: populates the database with realistic data for AI analytics testing.
 *
 * Run: npx tsx scripts/seed-analytics-data.ts
 *
 * WARNING: This DELETES all existing Product, User, Order, OrderItem, Review,
 * Cart, KnowledgeDocument, KnowledgeChunk, and ReviewInsight data before seeding.
 * Auth tables (Account, Session, VerificationToken) are preserved.
 */

import 'dotenv/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@/prisma/generated/prisma/client';
import * as crypto from 'crypto';

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// ── Helpers ──

function uid(): string {
  return crypto.randomUUID();
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randDecimal(min: number, max: number, decimals: number = 2): number {
  const val = Math.random() * (max - min) + min;
  return parseFloat(val.toFixed(decimals));
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(randBetween(8, 22), randBetween(0, 59), 0, 0);
  return d;
}

// ── Product Definitions ──

const PRODUCTS = [
  // Electronics
  { name: 'Wireless Noise-Cancelling Headphones Pro', slug: 'wireless-nc-headphones-pro', category: 'Electronics', brand: 'SoundMax', price: 299.99, stock: 150, isFeatured: true },
  { name: 'Ultra-Slim 15.6" Laptop', slug: 'ultra-slim-laptop-15', category: 'Electronics', brand: 'TechPro', price: 899.99, stock: 45, isFeatured: true },
  { name: 'Smartphone X200 5G', slug: 'smartphone-x200-5g', category: 'Electronics', brand: 'TechPro', price: 699.99, stock: 200, isFeatured: true },
  { name: 'Bluetooth Portable Speaker', slug: 'bluetooth-portable-speaker', category: 'Electronics', brand: 'SoundMax', price: 49.99, stock: 300, isFeatured: false },
  { name: '27" 4K Gaming Monitor', slug: '27-4k-gaming-monitor', category: 'Electronics', brand: 'PixelView', price: 549.99, stock: 30, isFeatured: true },
  { name: 'Mechanical RGB Gaming Keyboard', slug: 'mechanical-rgb-keyboard', category: 'Electronics', brand: 'KeyForce', price: 129.99, stock: 120, isFeatured: false },
  { name: 'Wireless Ergonomic Mouse', slug: 'wireless-ergonomic-mouse', category: 'Electronics', brand: 'KeyForce', price: 39.99, stock: 250, isFeatured: false },
  { name: '10" Digital Drawing Tablet', slug: '10-digital-drawing-tablet', category: 'Electronics', brand: 'PixelView', price: 199.99, stock: 60, isFeatured: false },

  // Clothing
  { name: 'Premium Cotton Classic T-Shirt', slug: 'premium-cotton-classic-tee', category: 'Clothing', brand: 'UrbanWear', price: 29.99, stock: 500, isFeatured: true },
  { name: 'Slim Fit Denim Jeans', slug: 'slim-fit-denim-jeans', category: 'Clothing', brand: 'UrbanWear', price: 79.99, stock: 200, isFeatured: false },
  { name: 'Waterproof Winter Jacket', slug: 'waterproof-winter-jacket', category: 'Clothing', brand: 'AlpineGear', price: 189.99, stock: 80, isFeatured: true },
  { name: 'Running Performance Shorts', slug: 'running-performance-shorts', category: 'Clothing', brand: 'SportFlex', price: 34.99, stock: 350, isFeatured: false },
  { name: 'Cashmere Blend Sweater', slug: 'cashmere-blend-sweater', category: 'Clothing', brand: 'UrbanWear', price: 119.99, stock: 90, isFeatured: false },

  // Home & Kitchen
  { name: 'Automatic Espresso Machine', slug: 'automatic-espresso-machine', category: 'Home & Kitchen', brand: 'BrewMaster', price: 449.99, stock: 40, isFeatured: true },
  { name: 'High-Speed Professional Blender', slug: 'high-speed-pro-blender', category: 'Home & Kitchen', brand: 'BrewMaster', price: 159.99, stock: 100, isFeatured: false },
  { name: 'Stainless Steel 12-Piece Cookware Set', slug: 'stainless-steel-cookware-set', category: 'Home & Kitchen', brand: 'ChefSelect', price: 249.99, stock: 55, isFeatured: true },
  { name: 'Smart WiFi Air Purifier', slug: 'smart-wifi-air-purifier', category: 'Home & Kitchen', brand: 'PureAir', price: 279.99, stock: 70, isFeatured: false },
  { name: 'Memory Foam Bed Pillow (2-Pack)', slug: 'memory-foam-pillow-2pack', category: 'Home & Kitchen', brand: 'DreamComfort', price: 59.99, stock: 180, isFeatured: false },

  // Sports & Outdoors
  { name: 'Professional Yoga Mat 6mm', slug: 'pro-yoga-mat-6mm', category: 'Sports & Outdoors', brand: 'SportFlex', price: 44.99, stock: 220, isFeatured: false },
  { name: 'Adjustable Dumbbell Set 5-25kg', slug: 'adjustable-dumbbell-set', category: 'Sports & Outdoors', brand: 'PowerLift', price: 349.99, stock: 35, isFeatured: true },
  { name: 'Ultra-Light Trail Running Shoes', slug: 'ultra-light-trail-running-shoes', category: 'Sports & Outdoors', brand: 'SportFlex', price: 129.99, stock: 140, isFeatured: false },
  { name: 'Insulated Stainless Steel Water Bottle 1L', slug: 'insulated-water-bottle-1l', category: 'Sports & Outdoors', brand: 'HydroCore', price: 34.99, stock: 400, isFeatured: false },

  // Books
  { name: 'The Art of Clean Code', slug: 'art-of-clean-code', category: 'Books', brand: 'TechPress', price: 39.99, stock: 500, isFeatured: false },
  { name: 'Data Science for Beginners', slug: 'data-science-beginners', category: 'Books', brand: 'TechPress', price: 49.99, stock: 300, isFeatured: false },
  { name: 'Modern JavaScript Deep Dive', slug: 'modern-javascript-deep-dive', category: 'Books', brand: 'TechPress', price: 54.99, stock: 200, isFeatured: true },
];

// ── User Definitions ──

const USERS = [
  { name: 'Admin User', email: 'admin@example.com', role: 'admin', registeredDaysAgo: 180 },
  { name: 'Alice Johnson', email: 'alice@example.com', role: 'user', registeredDaysAgo: 150 },
  { name: 'Bob Smith', email: 'bob@example.com', role: 'user', registeredDaysAgo: 140 },
  { name: 'Charlie Brown', email: 'charlie@example.com', role: 'user', registeredDaysAgo: 130 },
  { name: 'Diana Prince', email: 'diana@example.com', role: 'user', registeredDaysAgo: 120 },
  { name: 'Edward Norton', email: 'edward@example.com', role: 'user', registeredDaysAgo: 110 },
  { name: 'Fiona Apple', email: 'fiona@example.com', role: 'user', registeredDaysAgo: 100 },
  { name: 'George Lucas', email: 'george@example.com', role: 'user', registeredDaysAgo: 90 },
  { name: 'Hannah Montana', email: 'hannah@example.com', role: 'user', registeredDaysAgo: 80 },
  { name: 'Ivan Petrov', email: 'ivan@example.com', role: 'user', registeredDaysAgo: 70 },
  { name: 'Julia Roberts', email: 'julia@example.com', role: 'user', registeredDaysAgo: 60 },
  { name: 'Kevin Hart', email: 'kevin@example.com', role: 'user', registeredDaysAgo: 50 },
  { name: 'Lisa Simpson', email: 'lisa@example.com', role: 'user', registeredDaysAgo: 40 },
  { name: 'Mike Tyson', email: 'mike@example.com', role: 'user', registeredDaysAgo: 30 },
  { name: 'Nina Simone', email: 'nina@example.com', role: 'user', registeredDaysAgo: 20 },
  { name: 'Oscar Wilde', email: 'oscar@example.com', role: 'user', registeredDaysAgo: 15 },
  { name: 'Patricia Arquette', email: 'patricia@example.com', role: 'user', registeredDaysAgo: 10 },
  { name: 'Quentin Blake', email: 'quentin@example.com', role: 'user', registeredDaysAgo: 5 },
  { name: 'Rachel Green', email: 'rachel@example.com', role: 'user', registeredDaysAgo: 3 },
  { name: 'Sam Wilson', email: 'sam@example.com', role: 'user', registeredDaysAgo: 1 },
];

// ── Review content templates ──

const REVIEW_TEMPLATES = [
  { title: 'Absolutely love it!', description: 'This product exceeded all my expectations. The quality is outstanding and I use it every day. Highly recommended to anyone looking for a reliable option.', ratings: [4, 5] },
  { title: 'Great value for money', description: 'Really good quality for the price point. I compared several options before buying and this one offers the best features per dollar. Would buy again.', ratings: [4, 5] },
  { title: 'Decent product, minor issues', description: 'Overall a solid purchase. There are a few minor things I would improve - the packaging could be better and the instructions are a bit confusing. But the product itself works well.', ratings: [3, 4] },
  { title: 'Good but not great', description: 'It does the job but I was expecting more given the price. The build quality is average and it took longer than expected to set up. Not bad, not amazing.', ratings: [3] },
  { title: 'Perfect gift idea', description: 'Bought this as a birthday gift and the recipient was thrilled. The presentation is beautiful and it arrived right on time. Excellent shopping experience overall.', ratings: [5] },
  { title: 'Exceeded my expectations', description: 'I was hesitant at first but decided to give it a try. So glad I did! The performance is remarkable and the customer support team was very helpful when I had questions.', ratings: [4, 5] },
  { title: 'Not what I expected', description: 'Based on the product photos and description, I thought this would be different. The color is slightly off and the size runs smaller than advertised. Functionally it works fine though.', ratings: [2, 3] },
  { title: 'Solid performer', description: 'Have been using this for about 3 weeks now and it has been consistently reliable. No issues so far. Build quality feels premium and the design is sleek.', ratings: [4] },
  { title: 'Disappointed with quality', description: 'The product arrived with a small scratch and one of the accessories was missing. After contacting support they sent a replacement quickly, but the initial experience was frustrating.', ratings: [1, 2] },
  { title: 'Best in its class', description: 'After trying multiple brands in this category, this one is hands down the winner. Superior materials, thoughtful design, and excellent performance. Worth every penny.', ratings: [5] },
  { title: 'Good daily driver', description: 'Nothing fancy but it gets the job done reliably. I use it daily and it has held up well over the past month. Good purchase for everyday use.', ratings: [3, 4] },
  { title: 'Impressive build quality', description: 'You can tell a lot of thought went into the design and manufacturing. Every detail feels premium. The packaging was also very well done which shows they care about the customer experience.', ratings: [4, 5] },
];

// ── Address templates ──

const ADDRESSES = [
  { fullName: 'Alice Johnson', street: '123 Main Street', city: 'New York', state: 'NY', postalCode: '10001', country: 'USA' },
  { fullName: 'Bob Smith', street: '456 Oak Avenue', city: 'Los Angeles', state: 'CA', postalCode: '90001', country: 'USA' },
  { fullName: 'Charlie Brown', street: '789 Pine Road', city: 'Chicago', state: 'IL', postalCode: '60601', country: 'USA' },
  { fullName: 'Diana Prince', street: '321 Elm Street', city: 'Houston', state: 'TX', postalCode: '77001', country: 'USA' },
  { fullName: 'Edward Norton', street: '654 Maple Drive', city: 'Phoenix', state: 'AZ', postalCode: '85001', country: 'USA' },
  { fullName: 'Fiona Apple', street: '987 Cedar Lane', city: 'Philadelphia', state: 'PA', postalCode: '19101', country: 'USA' },
  { fullName: 'George Lucas', street: '147 Birch Way', city: 'San Antonio', state: 'TX', postalCode: '78201', country: 'USA' },
  { fullName: 'Hannah Montana', street: '258 Walnut Court', city: 'San Diego', state: 'CA', postalCode: '92101', country: 'USA' },
];

const PAYMENT_METHODS = ['Stripe', 'PayPal', 'Credit Card', 'Debit Card'];

// ── Main Seed Function ──

async function main() {
  console.log('Cleaning existing data...');

  // Delete in reverse dependency order
  await prisma.reviewInsight.deleteMany();
  await prisma.knowledgeChunk.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
  await prisma.review.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();

  console.log('Seeding products...');
  const productRecords: Array<{ id: string; name: string; slug: string; category: string; brand: string; price: number; stock: number }> = [];

  for (const p of PRODUCTS) {
    const rating = randDecimal(2.5, 5.0, 2);
    const numReviews = randBetween(0, 25);
    const product = await prisma.product.create({
      data: {
        id: uid(),
        name: p.name,
        slug: p.slug,
        category: p.category,
        brand: p.brand,
        description: `${p.name} - Premium quality ${p.category.toLowerCase()} product from ${p.brand}. Designed for exceptional performance and durability.`,
        images: [
          `https://picsum.photos/seed/${p.slug}/600/600`,
          `https://picsum.photos/seed/${p.slug}-2/600/600`,
        ],
        price: p.price,
        stock: p.stock,
        rating,
        numReviews,
        isFeatured: p.isFeatured,
        banner: p.isFeatured ? `https://picsum.photos/seed/${p.slug}-banner/1200/400` : null,
        createdAt: daysAgo(randBetween(30, 200)),
      },
    });
    productRecords.push({
      id: product.id,
      name: p.name,
      slug: p.slug,
      category: p.category,
      brand: p.brand,
      price: p.price,
      stock: p.stock,
    });
  }
  console.log(`  Created ${productRecords.length} products`);

  // ── Users ──

  console.log('Seeding users...');
  const userRecords: Array<{ id: string; name: string; email: string; role: string }> = [];

  for (const u of USERS) {
    const user = await prisma.user.create({
      data: {
        id: uid(),
        name: u.name,
        email: u.email,
        role: u.role,
        password: '$2a$10$dummyhashfordevelopmentonly1234567890abcdef', // dummy hash
        emailVerified: daysAgo(u.registeredDaysAgo),
        createdAt: daysAgo(u.registeredDaysAgo + randBetween(0, 4)),
      },
    });
    userRecords.push({
      id: user.id,
      name: u.name,
      email: u.email,
      role: u.role,
    });
  }
  console.log(`  Created ${userRecords.length} users`);

  // ── Orders ──

  console.log('Seeding orders and order items...');
  let orderCount = 0;
  let orderItemCount = 0;

  // Generate 50-80 orders across the last 6 months
  const totalOrders = randBetween(50, 80);

  for (let i = 0; i < totalOrders; i++) {
    const user = pick(userRecords);
    const daysAgoVal = randBetween(1, 180);
    const createdAt = daysAgo(daysAgoVal);

    // 80% of orders are paid, 60% are delivered
    const isPaid = Math.random() < 0.8;
    const isDelivered = isPaid && Math.random() < 0.75;

    const itemsCount = randBetween(1, 5);
    const orderItems: Array<{ productId: string; qty: number; price: number; name: string; slug: string; image: string }> = [];

    // Select random unique products for this order
    const shuffledProducts = [...productRecords].sort(() => Math.random() - 0.5);
    const orderProducts = shuffledProducts.slice(0, itemsCount);

    for (const prod of orderProducts) {
      const qty = randBetween(1, 3);
      orderItems.push({
        productId: prod.id,
        qty,
        price: prod.price,
        name: prod.name,
        slug: prod.slug,
        image: `https://picsum.photos/seed/${prod.slug}/600/600`,
      });
    }

    const itemsPrice = orderItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    const shippingPrice = itemsPrice > 100 ? 0 : randDecimal(5.99, 14.99);
    const taxPrice = parseFloat((itemsPrice * 0.08).toFixed(2));
    const totalPrice = parseFloat((itemsPrice + shippingPrice + taxPrice).toFixed(2));

    const address = pick(ADDRESSES);
    const paidAt = isPaid ? new Date(createdAt.getTime() + randBetween(1, 48) * 3600000) : null;
    const deliveredAt = isDelivered ? new Date(paidAt!.getTime() + randBetween(24, 120) * 3600000) : null;

    const order = await prisma.order.create({
      data: {
        id: uid(),
        userId: user.id,
        shippingAddress: {
          fullName: address.fullName,
          street: address.street,
          city: address.city,
          state: address.state,
          postalCode: address.postalCode,
          country: address.country,
        },
        paymentMethod: pick(PAYMENT_METHODS),
        itemsPrice,
        shippingPrice,
        taxPrice,
        totalPrice,
        isPaid,
        paidAt,
        isDelivered,
        deliveredAt,
        createdAt,
      },
    });

    // Create OrderItems
    for (const item of orderItems) {
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          productId: item.productId,
          qty: item.qty,
          price: item.price,
          name: item.name,
          slug: item.slug,
          image: item.image,
        },
      });
      orderItemCount++;
    }
    orderCount++;
  }
  console.log(`  Created ${orderCount} orders with ${orderItemCount} order items`);

  // ── Reviews ──

  console.log('Seeding reviews...');
  let reviewCount = 0;

  // Create 80-120 reviews
  const totalReviews = randBetween(80, 120);

  for (let i = 0; i < totalReviews; i++) {
    const user = pick(userRecords);
    const product = pick(productRecords);
    const template = pick(REVIEW_TEMPLATES);
    const rating = pick(template.ratings);
    const isVerified = Math.random() < 0.7;

    await prisma.review.create({
      data: {
        id: uid(),
        userId: user.id,
        productId: product.id,
        rating,
        title: template.title,
        description: template.description,
        isVerifiedPurchase: isVerified,
        createdAt: daysAgo(randBetween(1, 150)),
      },
    });
    reviewCount++;
  }

  // Update product ratings based on reviews
  for (const product of productRecords) {
    const reviews = await prisma.review.findMany({
      where: { productId: product.id },
      select: { rating: true },
    });
    if (reviews.length > 0) {
      const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
      await prisma.product.update({
        where: { id: product.id },
        data: {
          rating: parseFloat(avg.toFixed(2)),
          numReviews: reviews.length,
        },
      });
    }
  }
  console.log(`  Created ${reviewCount} reviews`);

  // ── Carts (some abandoned) ──

  console.log('Seeding carts...');
  let cartCount = 0;
  const usersWithCarts = [...userRecords].sort(() => Math.random() - 0.5).slice(0, 12);

  for (const user of usersWithCarts) {
    const cartProducts = [...productRecords].sort(() => Math.random() - 0.5).slice(0, randBetween(1, 4));
    const items = cartProducts.map(p => ({
      productId: p.id,
      name: p.name,
      slug: p.slug,
      qty: randBetween(1, 2),
      price: p.price,
      image: `https://picsum.photos/seed/${p.slug}/600/600`,
    }));
    const itemsPrice = items.reduce((sum: number, item: any) => sum + item.price * item.qty, 0);

    await prisma.cart.create({
      data: {
        id: uid(),
        userId: user.id,
        sessionCartId: uid(),
        items: items as any,
        itemsPrice,
        totalPrice: itemsPrice,
        shippingPrice: itemsPrice > 100 ? 0 : 9.99,
        taxPrice: parseFloat((itemsPrice * 0.08).toFixed(2)),
        createdAt: daysAgo(randBetween(0, 7)),
      },
    });
    cartCount++;
  }
  console.log(`  Created ${cartCount} carts`);

  console.log('\nSeed complete! Summary:');
  console.log(`  Products:      ${productRecords.length}`);
  console.log(`  Users:         ${userRecords.length}`);
  console.log(`  Orders:        ${orderCount}`);
  console.log(`  OrderItems:    ${orderItemCount}`);
  console.log(`  Reviews:       ${reviewCount}`);
  console.log(`  Carts:         ${cartCount}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
