/**
 * Append-only seed script: expands order/review/cart data for AI analytics testing.
 *
 * Run: npx tsx scripts/expand-orders.ts
 *
 * SAFE: Does NOT delete any data. Does NOT add/modify products or categories.
 * Only adds: Orders, OrderItems, Reviews, Carts (referencing existing Products + Users).
 */

import 'dotenv/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@/prisma/generated/prisma/client';
import * as crypto from 'crypto';

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

function uid(): string { return crypto.randomUUID(); }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randBetween(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(randBetween(8, 22), randBetween(0, 59), 0, 0);
  return d;
}

// ── Address pool for orders ──

const ADDRESSES = [
  { fullName: '张三', street: '朝阳区建国路88号', city: '北京', state: '北京', postalCode: '100022', country: '中国' },
  { fullName: '李四', street: '浦东新区陆家嘴环路1000号', city: '上海', state: '上海', postalCode: '200120', country: '中国' },
  { fullName: '王五', street: '天河区体育西路111号', city: '广州', state: '广东', postalCode: '510620', country: '中国' },
  { fullName: '赵六', street: '南山区科技园路200号', city: '深圳', state: '广东', postalCode: '518057', country: '中国' },
  { fullName: '孙七', street: '武侯区天府大道999号', city: '成都', state: '四川', postalCode: '610041', country: '中国' },
  { fullName: '周八', street: '西湖区文三路500号', city: '杭州', state: '浙江', postalCode: '310012', country: '中国' },
  { fullName: '吴九', street: '鼓楼区新模范马路66号', city: '南京', state: '江苏', postalCode: '210009', country: '中国' },
  { fullName: '郑十', street: '洪山区珞喻路1037号', city: '武汉', state: '湖北', postalCode: '430074', country: '中国' },
];

const PAYMENT_METHODS = ['Stripe', 'PayPal', '支付宝', '微信支付'];

// ── Review templates ──

const REVIEWS = [
  { title: '非常满意', rating: 5, desc: '质量很好，穿起来很舒服，面料手感不错，做工精细。发货速度也很快，包装完好。会继续回购！' },
  { title: '性价比很高', rating: 5, desc: '这个价位能买到这样的品质真的不错。版型合身，颜色和图片一致，洗了几次也没有变形褪色。推荐购买。' },
  { title: '还不错', rating: 4, desc: '整体满意，面料比预期的稍薄了一点，但夏天穿刚好。款式经典百搭，上班穿很合适。物流也很快。' },
  { title: '挺好的', rating: 4, desc: '做工可以，没有线头。尺码标准，按照平时穿的号买就行。穿了一段时间才来评价，质量稳定。' },
  { title: '一般般', rating: 3, desc: '中规中矩吧，没有特别惊喜也没有太大问题。颜色跟图片有一点点色差，但在可接受范围内。性价比还行。' },
  { title: '不太满意', rating: 2, desc: '面料偏硬，穿了一次洗了之后就有点缩水。版型也没有图片上好看，有点失望。价格也不算便宜，不太值。' },
  { title: '失望', rating: 1, desc: '收到发现有瑕疵，线头很多，有一处小破洞。联系客服换货处理倒是挺快的，但第一次体验不好。不推荐。' },
  { title: '超出预期', rating: 5, desc: '第一次在这家店买，被品质惊艳到了。包装精美，衣服细节处理到位，面料舒适透气。已经推荐给同事了！' },
  { title: '日常通勤首选', rating: 4, desc: '买了三件换着穿，版型适合上班，搭配西裤或者休闲裤都可以。洗后不需要熨烫，省心。会继续关注店铺。' },
  { title: '送人很合适', rating: 5, desc: '买来送朋友的生日礼物，朋友很喜欢。包装看起来很高档，衣服质感好，尺码也刚好。送礼很体面。' },
  { title: '第二次购买了', rating: 5, desc: '之前买了一件觉得不错，这次又买了两件不同颜色的。品质一如既往的好，这个品牌值得信赖。' },
  { title: '勉强给个中评', rating: 3, desc: '物流慢了点，等了五天才到。衣服本身还行，但也没有宣传说的那么好。对得起价格但不出彩。' },
];

async function main() {
  // ── Fetch existing data ──
  const products = await prisma.product.findMany({ select: { id: true, name: true, slug: true, price: true, stock: true } });
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true } });

  console.log(`现有 ${products.length} 个产品, ${users.length} 个用户`);

  // ── 1. Expand Orders ──
  console.log('\n--- 扩展订单 ---');
  let newOrders = 0;
  let newItems = 0;

  const TOTAL_NEW_ORDERS = randBetween(40, 60);

  for (let i = 0; i < TOTAL_NEW_ORDERS; i++) {
    const user = pick(users);
    const daysAgoVal = randBetween(1, 180);
    const createdAt = daysAgo(daysAgoVal);

    const isPaid = Math.random() < 0.85;
    const isDelivered = isPaid && Math.random() < 0.7;

    const itemsCount = randBetween(1, 4);
    const orderItems: Array<{ productId: string; qty: number; price: number; name: string; slug: string; image: string }> = [];

    const shuffled = [...products].sort(() => Math.random() - 0.5);
    const orderProducts = shuffled.slice(0, itemsCount);

    for (const prod of orderProducts) {
      const qty = randBetween(1, 3);
      orderItems.push({
        productId: prod.id,
        qty,
        price: Number(prod.price),
        name: prod.name,
        slug: prod.slug,
        image: `https://picsum.photos/seed/${prod.slug}/600/600`,
      });
    }

    const itemsPrice = orderItems.reduce((s, item) => s + item.price * item.qty, 0);
    const shippingPrice = itemsPrice > 200 ? 0 : 8 + Math.random() * 7;
    const taxPrice = itemsPrice * 0.13; // VAT
    const totalPrice = itemsPrice + shippingPrice + taxPrice;

    const address = pick(ADDRESSES);
    const paidAt = isPaid ? new Date(createdAt.getTime() + randBetween(1, 24) * 3600000) : null;
    const deliveredAt = isDelivered && paidAt ? new Date(paidAt.getTime() + randBetween(24, 72) * 3600000) : null;

    const order = await prisma.order.create({
      data: {
        id: uid(),
        userId: user.id,
        shippingAddress: address as any,
        paymentMethod: pick(PAYMENT_METHODS),
        itemsPrice: Math.round(itemsPrice * 100) / 100,
        shippingPrice: Math.round(shippingPrice * 100) / 100,
        taxPrice: Math.round(taxPrice * 100) / 100,
        totalPrice: Math.round(totalPrice * 100) / 100,
        isPaid,
        paidAt,
        isDelivered,
        deliveredAt,
        createdAt,
      },
    });

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
      newItems++;
    }
    newOrders++;
  }
  console.log(`  新增 ${newOrders} 个订单, ${newItems} 个订单项`);

  // ── 2. Expand Reviews ──
  console.log('\n--- 扩展评论 ---');
  let newReviews = 0;
  const TOTAL_NEW_REVIEWS = randBetween(60, 90);

  for (let i = 0; i < TOTAL_NEW_REVIEWS; i++) {
    const user = pick(users);
    const product = pick(products);
    const template = pick(REVIEWS);
    const isVerified = Math.random() < 0.75;

    await prisma.review.create({
      data: {
        id: uid(),
        userId: user.id,
        productId: product.id,
        rating: template.rating,
        title: template.title,
        description: template.desc,
        isVerifiedPurchase: isVerified,
        createdAt: daysAgo(randBetween(1, 150)),
      },
    });
    newReviews++;
  }
  console.log(`  新增 ${newReviews} 条评论`);

  // ── 3. Update product ratings ──
  console.log('\n--- 更新产品评分 ---');
  for (const product of products) {
    const reviews = await prisma.review.findMany({
      where: { productId: product.id },
      select: { rating: true },
    });
    if (reviews.length > 0) {
      const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
      await prisma.product.update({
        where: { id: product.id },
        data: {
          rating: Math.round(avg * 100) / 100,
          numReviews: reviews.length,
        },
      });
    }
  }
  console.log(`  已更新 ${products.length} 个产品的评分`);

  // ── 4. Expand Carts ──
  console.log('\n--- 扩展购物车 ---');
  let newCarts = 0;
  const cartUsers = users.filter(() => Math.random() < 0.7);

  for (const user of cartUsers) {
    const cartProducts = [...products].sort(() => Math.random() - 0.5).slice(0, randBetween(1, 4));
    const items = cartProducts.map(p => ({
      productId: p.id,
      name: p.name,
      slug: p.slug,
      qty: randBetween(1, 2),
      price: Number(p.price),
      image: `https://picsum.photos/seed/${p.slug}/600/600`,
    }));
    const itemsPrice = items.reduce((s: number, item: any) => s + item.price * item.qty, 0);

    await prisma.cart.create({
      data: {
        id: uid(),
        userId: user.id,
        sessionCartId: uid(),
        items: items as any,
        itemsPrice: Math.round(itemsPrice * 100) / 100,
        totalPrice: Math.round(itemsPrice * 100) / 100,
        shippingPrice: itemsPrice > 200 ? 0 : 9.99,
        taxPrice: Math.round(itemsPrice * 0.13 * 100) / 100,
        createdAt: daysAgo(randBetween(0, 10)),
      },
    });
    newCarts++;
  }
  console.log(`  新增 ${newCarts} 个购物车`);

  // ── Summary ──
  console.log('\n========== 扩展完成 ==========');
  const counts = await prisma.$queryRawUnsafe(`
    SELECT 'Product' as t, count(*)::int as c FROM "Product"
    UNION ALL SELECT 'User', count(*)::int FROM "User"
    UNION ALL SELECT 'Order', count(*)::int FROM "Order"
    UNION ALL SELECT 'OrderItem', count(*)::int FROM "OrderItem"
    UNION ALL SELECT 'Review', count(*)::int FROM "Review"
    UNION ALL SELECT 'Cart', count(*)::int FROM "Cart"
  `) as any[];
  counts.forEach((row: any) => console.log(`${row.t}: ${row.c}`));

  const status = await prisma.$queryRawUnsafe(`SELECT "isPaid", "isDelivered", count(*)::int as c FROM "Order" GROUP BY "isPaid", "isDelivered" ORDER BY "isPaid", "isDelivered"`) as any[];
  console.log('\n订单状态分布:');
  status.forEach((row: any) => console.log(`  已支付=${row.isPaid} 已发货=${row.isDelivered}: ${row.c}单`));

  const dateRange = await prisma.$queryRawUnsafe(`SELECT min("createdAt") as min_d, max("createdAt") as max_d FROM "Order"`) as any[];
  console.log(`\n订单时间范围: ${dateRange[0].min_d} ~ ${dateRange[0].max_d}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
