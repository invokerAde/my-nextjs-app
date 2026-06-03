'use server';

import 'dotenv/config';
import { PrismaClient } from '@/prisma/generated/prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { indexDocument } from '@/lib/services/index.service';
import { ingestProductReviews } from '@/lib/services/review-ingestion.service';

const SOURCE_REF = 'synthetic-rag-fixtures-v1';

// ── Lazy raw PrismaClient (no $extends, for direct CRUD on new models) ──

let _rawPrisma: PrismaClient | null = null;

function getRawPrisma(): PrismaClient {
  if (!_rawPrisma) {
    _rawPrisma = new PrismaClient({
      adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
    });
  }
  return _rawPrisma;
}

// ── Spec templates ──

interface SpecTemplate {
  material: string[];
  fit: string[];
  collar: string[];
  sleeve_length: string[];
  thickness: string[];
  stretch: string[];
  breathability: string[];
  occasion: string[];
  season: string[];
  care_instructions: string;
  highlights: string[];
  limitations: string[];
}

const SHIRT_SPECS: SpecTemplate = {
  material: ['纯棉', '棉涤混纺', '牛津纺', '府绸', '竹纤维混纺'],
  fit: ['修身', '常规', '宽松', 'slim fit'],
  collar: ['尖领', '温莎领', '纽扣领', '小方领'],
  sleeve_length: ['长袖', '长袖'],
  thickness: ['适中', '偏薄'],
  stretch: ['无弹性', '微弹'],
  breathability: ['良好', '优秀', '一般'],
  occasion: ['商务通勤', '日常休闲', '约会', '面试', '上班'],
  season: ['春秋', '四季通用', '夏季'],
  care_instructions: '建议手洗或轻柔机洗，水温不超过30°C，低温熨烫，不可漂白',
  highlights: ['面料挺括不易皱', '领口定型工艺', '多色可选', '版型显瘦', '透气不闷汗'],
  limitations: ['深色首次洗涤可能有轻微浮色', '浅色款微透', '棉质面料久穿会轻微变形', '偏硬需多次洗涤软化'],
};

const HOODIE_SPECS: SpecTemplate = {
  material: ['纯棉毛圈', '棉涤混纺加绒', '抓绒', '摇粒绒'],
  fit: ['宽松', 'oversize', '常规'],
  collar: ['连帽', '圆领', '半拉链立领'],
  sleeve_length: ['长袖', '长袖'],
  thickness: ['加厚', '适中', '厚实'],
  stretch: ['微弹', '微弹'],
  breathability: ['一般', '适中', '良好'],
  occasion: ['日常休闲', '运动健身', '居家', '出行', '聚会'],
  season: ['秋冬', '春秋', '冬季'],
  care_instructions: '反面洗涤，建议手洗或轻柔机洗，不可高温烘干，深色与浅色分开洗涤',
  highlights: ['保暖性好', '柔软亲肤', '百搭款', '不易起球', '宽松舒适不束缚'],
  limitations: ['深色首次洗涤可能掉毛', '加绒款略厚重', '帽子洗后容易变形', '白色不耐脏'],
};

const SPEC_MAP: Record<string, SpecTemplate> = {
  "Men's Dress Shirts": SHIRT_SPECS,
  "Men's Sweatshirts": HOODIE_SPECS,
};

// ── Review templates ──

const FIT_REVIEWS = {
  positive: [
    '尺码很准，按平时的码买就行。我180/75穿L刚刚好，肩宽和衣长都很合适。',
    '版型不错，修身但不勒，活动也很自如。建议按正常尺码购入。',
    '我偏瘦，买了小一码刚刚好。客服推荐的尺码很准，给个赞。',
    '版型显瘦，穿上比我想象的好很多，同事都问链接。',
  ],
  negative: [
    '尺码偏大，我按平时穿的买的L码，结果穿上像借来的，建议买小一码。',
    '袖子偏长，我175穿M码，袖口都盖过手背了，版型有点问题。',
    '肩宽不对劲，我明明量了尺寸按表买的，结果肩部紧绷，换大了一码又太松。',
    '衣长偏短，抬手的衣服就会跑出来，不太适合高个子。',
  ],
};

const FABRIC_REVIEWS = {
  positive: [
    '面料很舒服，纯棉的贴身穿完全不扎人，夏天穿也很透气。',
    '材质出乎意料的好，摸起来挺括有质感，不像这个价位的东西。',
    '穿了一周了，面料没有起球也没有变形，品质感真不错。',
    '透气性很好，这几天30多度穿着也不闷，比之前买的那件强多了。',
  ],
  negative: [
    '面料一般，洗了一次就有轻微起球，感觉不太耐穿。',
    '材质偏硬，下水洗了两次还是硬邦邦的，穿着不太舒服。',
    '说是纯棉但感觉化纤成分不少，不透气，穿半天就有汗味。',
  ],
};

const COLOR_WORKMANSHIP_REVIEWS = [
  '做工精细没有线头，扣子也缝得很牢固。颜色和图片一致没有色差，整体很满意。',
  '走线工整没有跑线的地方，拉链很顺滑。颜色正，比我想象的好看。',
  '细节处理一般，袖口内侧有线头需要自己剪。但颜色确实好看，实物比图片好看。',
  '做工中规中矩，这个价格算是物有所值。颜色稍微有点色差，但可以接受。',
  '扣子有一颗松的，穿之前得自己加固一下。其他方面还行，颜色挺正的，没有明显色差。',
];

const NOISE_REVIEWS = [
  '物流很快第二天就到了，包装也很严实没有损坏。',
  '快递小哥态度很好，送货上门还提醒验货。衣服还没穿，先给好评。',
  '物流慢了点等了一个多星期才收到，但东西本身还行。客服回复速度一般。',
  '买了送人的，物流包装都还可以，等对方穿了再来追评。',
];

const MIXED_REVIEWS = [
  '整体还行但有些小瑕疵。版型很好面料也舒服，就是袖口的线头有点多，自己处理了一下。价格嘛这个价位算过得去。',
  '优缺点都很明显。优点是颜色好看穿着舒服透气性不错，缺点是容易皱熨烫比较费时间，打理不太方便。',
  '中规中矩的购物体验。版型正常没有惊喜也没有惊吓，材质一般般对得起这个价格，没有太多可说的。',
];

// ── Policy FAQ templates ──

const POLICY_FAQS = [
  { title: '退换货政策', content: buildFAQ([
    ['7天无理由退货怎么操作？', '签收后7天内，保持商品完好（未下水、吊牌完整、不影响二次销售），可直接在订单详情页申请退货。审核通过后系统会生成退货地址，寄回后3个工作日内退款。'],
    ['退货后多久能收到退款？', '仓库签收退货后，退款会在1-3个工作日原路返回。支付宝/微信支付通常1个工作日内到账，银行卡支付需要3-5个工作日。'],
    ['换货的流程是怎样的？', '先在订单页申请换货并注明原因，审核通过后寄回原商品。仓库收到后2个工作日内发出新商品，来回运费由我们承担。'],
    ['已经下水洗过的衣服还能退吗？', '已下水或洗涤过的商品无法办理退换货。建议试穿时保留吊牌，确认合适后再拆洗唛。'],
    ['吊牌拆了但没洗过能退吗？', '如果吊牌拆了但衣服没有穿着痕迹和洗涤痕迹，部分情况下可协商退货。建议保留原包装联系客服。'],
    ['海外订单可以退货吗？', '目前仅支持中国大陆地址退货。海外订单如有质量问题可联系客服协商处理。'],
  ]) },
  { title: '发货与物流', content: buildFAQ([
    ['下单后多久发货？', '工作日16:00前下单当天发出，之后次工作日发。周末节假日顺延。一般48小时内发出。'],
    ['发什么快递？能指定吗？', '默认中通/圆通/申通随机，满299发顺丰。如需指定快递请订单备注。'],
    ['多久能收到？', '江浙沪1-2天，其他地区3-5天，偏远地区5-7天。大促期可能延迟1-2天。'],
    ['怎么查物流？', '发货后订单详情页显示运单号，可直接点击追踪。长时间未更新联系客服核实。'],
    ['快递丢失了怎么办？', '物流信息超过5天未更新请联系客服。确认丢失后安排补发或全额退款。'],
  ]) },
  { title: '支付与发票', content: buildFAQ([
    ['支持哪些支付方式？', '支持微信支付、支付宝、银行卡、PayPal和Stripe。海外用户建议使用PayPal或Stripe。'],
    ['可以开票吗？', '支持增值税普通发票和专用发票。下单时备注开票信息，电子发票确认收货后3个工作日内发至邮箱。'],
    ['发票可以补开吗？', '订单完成后30天内可联系客服补开。超过30天可能无法补开。'],
    ['付款后还可以修改订单吗？', '未发货前可联系客服修改地址或规格。已发货订单不支持修改。'],
    ['为什么付款失败了？', '可能原因：银行卡限额、信用卡授权失败、网络超时。建议更换支付方式或稍后重试。'],
  ]) },
  { title: '售后与质量问题', content: buildFAQ([
    ['收到的衣服有质量问题怎么办？', '签收后48小时内拍照联系客服。质量问题（破洞、严重色差、开线、污渍等）我们承担来回运费退换。'],
    ['什么算质量问题？', '明显破洞/开线、严重色差、污渍、拉链损坏、扣子脱落。轻微色差、线头、褶皱不算质量问题。'],
    ['穿了几次坏了能保修吗？', '目前不提供穿后保修。正常穿着下短期出现非人为损坏可协商处理。'],
    ['申请售后需要什么材料？', '需提供：订单号、商品实物照片（清晰展示问题部位）、外包装照片、简要问题描述。'],
    ['售后处理时效？', '提交后24小时内客服回复。确认为质量问题后，退换货流程通常3-5个工作日完成。'],
  ]) },
  { title: '清洗与保养建议', content: buildFAQ([
    ['衣服怎么洗不容易变形？', '建议反面洗涤、使用洗衣袋、轻柔模式。水温不超过30°C。棉质衣物洗后平铺晾干，不可暴晒。'],
    ['深色衣服掉色怎么办？', '深色衣物首次洗涤建议盐水浸泡30分钟固色。前几次单独洗涤，不与浅色混洗。'],
    ['衬衫怎么熨烫？', '棉质衬衫建议蒸汽熨斗中温熨烫。先熨领子再熨袖口，然后前后片。熨前喷少许水效果更好。'],
    ['羊毛/羊绒怎么保养？', '建议干洗或专用洗涤液手洗。不可机洗、不可拧干、不可暴晒。平铺晾干，存放时使用防蛀片。'],
    ['白色衣服发黄了怎么办？', '可用稀释白醋或小苏打浸泡，再用彩漂液处理。日常穿着后及时清洗，汗渍会导致发黄。'],
  ]) },
];

function buildFAQ(entries: [string, string][]): string {
  return entries.map(([q, a]) => `Q: ${q}\nA: ${a}`).join('\n\n');
}

// ── Helpers ──

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function randBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildSpecJson(category: string): Record<string, string> {
  const tpl = SPEC_MAP[category] ?? SHIRT_SPECS;
  return {
    material: pick(tpl.material),
    fit: pick(tpl.fit),
    collar: pick(tpl.collar),
    sleeve_length: pick(tpl.sleeve_length),
    thickness: pick(tpl.thickness),
    stretch: pick(tpl.stretch),
    breathability: pick(tpl.breathability),
    occasion: pick(tpl.occasion),
    season: pick(tpl.season),
    care_instructions: tpl.care_instructions,
    size_advice: ['建议按正常尺码购买', '建议买小一码', '建议买大一码', '正常尺码偏修身可选大一码'][randBetween(0, 3)],
    highlights: pickN(tpl.highlights, 3).join('；'),
    limitations: pickN(tpl.limitations, 2).join('；'),
  };
}

function generateReviews(count: number): string[] {
  const reviews: string[] = [];
  const fitCount = randBetween(2, 4);
  for (let i = 0; i < fitCount; i++) {
    reviews.push(i === 0 ? pick(FIT_REVIEWS.negative) : pick(FIT_REVIEWS.positive));
  }
  const fabricCount = randBetween(2, 4);
  for (let i = 0; i < fabricCount; i++) {
    reviews.push(i < 2 ? pick(FABRIC_REVIEWS.positive) : pick(FABRIC_REVIEWS.negative));
  }
  const cwCount = randBetween(1, 3);
  for (let i = 0; i < cwCount; i++) {
    reviews.push(pick(COLOR_WORKMANSHIP_REVIEWS));
  }
  const noiseCount = randBetween(1, 2);
  for (let i = 0; i < noiseCount; i++) {
    reviews.push(pick(NOISE_REVIEWS));
  }
  const mixedCount = randBetween(1, 2);
  for (let i = 0; i < mixedCount; i++) {
    reviews.push(pick(MIXED_REVIEWS));
  }
  return reviews.sort(() => Math.random() - 0.5).slice(0, count);
}

function buildProductDetailContent(
  product: { name: string; brand: string; category: string; description: string },
  specs: Record<string, string>,
): string {
  return [
    `${product.name}`,
    `品牌：${product.brand}`,
    `类目：${product.category}`,
    '',
    `商品描述：${product.description}`,
    '',
    '规格参数：',
    `- 材质：${specs.material}`,
    `- 版型：${specs.fit}`,
    `- 领型：${specs.collar}`,
    `- 袖长：${specs.sleeve_length}`,
    `- 厚度：${specs.thickness}`,
    `- 弹性：${specs.stretch}`,
    `- 透气性：${specs.breathability}`,
    `- 适用场景：${specs.occasion}`,
    `- 适用季节：${specs.season}`,
    '',
    `亮点：${specs.highlights}`,
    '',
    `注意事项：${specs.limitations}`,
    '',
    `洗护建议：${specs.care_instructions}`,
    '',
    `尺码建议：${specs.size_advice}`,
  ].join('\n');
}

// ── Main export ──

export async function generateRagFixtures(): Promise<{
  products: number;
  specs: number;
  reviews: number;
  productDocs: number;
  policyDocs: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const rp = getRawPrisma();

  console.log('[fixtures] Cleaning old synthetic data...');

  try {
    // Clean old synthetic knowledge docs + chunks
    const { prisma: ragPrisma } = await import('@/lib/rag/db');
    const oldDocs = await ragPrisma.knowledgeDocument.findMany({
      where: { sourceRef: SOURCE_REF },
      select: { id: true },
    });
    for (const d of oldDocs) {
      await ragPrisma.knowledgeChunk.deleteMany({ where: { documentId: d.id } });
    }
    await ragPrisma.knowledgeDocument.deleteMany({ where: { sourceRef: SOURCE_REF } });
    await ragPrisma.reviewInsight.deleteMany({ where: { id: { not: '' } } });

    // Clean old synthetic product specs
    await rp.$executeRawUnsafe(`DELETE FROM "ProductSpec"`);
    // Clean old reviews (this is a fixture tool, safe to wipe)
    await rp.$executeRawUnsafe(`DELETE FROM "Review"`);

    console.log('[fixtures] Old data cleaned.');
  } catch (err: any) {
    errors.push(`Cleanup: ${err.message}`);
    console.error('[fixtures] Cleanup error:', err);
  }

  // ── Ensure synthetic user exists ──
  let fixtureUserId: string;
  const existingUser = await rp.user.findFirst({
    where: { email: 'admin@example.com' },
    select: { id: true },
  });
  if (existingUser) {
    fixtureUserId = existingUser.id;
  } else {
    // Create synthetic placeholder user
    fixtureUserId = '00000000-0000-0000-0000-000000000000';
    await rp.$executeRawUnsafe(
      `INSERT INTO "User" (id, name, email, role, "createdAt", "updatedAt")
       VALUES ($1, 'SyntheticUser', 'synthetic@rag.fixture', 'user', NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET id = "User".id RETURNING id`,
      fixtureUserId,
    );
    // Re-fetch
    const created = await rp.user.findFirstOrThrow({ where: { email: 'synthetic@rag.fixture' }, select: { id: true } });
    fixtureUserId = created.id;
  }

  // ── Process products ──
  const products = await rp.product.findMany({
    select: { id: true, name: true, category: true, brand: true, description: true },
  });
  console.log(`[fixtures] Processing ${products.length} products...`);

  let specsCount = 0;
  let reviewsCount = 0;
  let productDocsCount = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    try {
      // 1. ProductSpec
      const specs = buildSpecJson(p.category);
      await rp.$executeRawUnsafe(
        `INSERT INTO "ProductSpec" (id, "productId", specs, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2::json, NOW(), NOW())
         ON CONFLICT ("productId") DO UPDATE SET specs = $2::json, "updatedAt" = NOW()`,
        p.id,
        JSON.stringify(specs),
      );
      specsCount++;

      // 2. product_detail via indexDocument (chunk + embedding + tsvector)
      const detailContent = buildProductDetailContent(p, specs);
      await indexDocument({
        productId: p.id,
        docType: 'product_detail',
        title: `${p.name} — 商品详情`,
        content: detailContent,
        sourceRef: SOURCE_REF,
      });
      productDocsCount++;

      // 3. Reviews: vary count to test both paths
      const reviewCount = i < 2
        ? randBetween(3, 4)   // ≤ threshold → direct path
        : randBetween(6, 12); // > threshold → aggregate path
      const reviewTexts = generateReviews(reviewCount);

      for (let ri = 0; ri < reviewTexts.length; ri++) {
        await rp.$executeRawUnsafe(
          `INSERT INTO "Review" (id, "userId", "productId", rating, title, description, "isVerifiedPurchase", "createdAt")
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, true, NOW())`,
          fixtureUserId,
          p.id,
          randBetween(3, 5),
          `合成评测 #${ri + 1}`,
          reviewTexts[ri],
        );
        reviewsCount++;
      }
    } catch (err: any) {
      errors.push(`Product ${p.id}: ${err.message}`);
      console.error(`[fixtures] Product ${p.id} error:`, err);
    }
  }

  // ── Policy FAQ documents ──
  console.log('[fixtures] Creating policy FAQ documents...');
  let policyDocsCount = 0;

  for (const faq of POLICY_FAQS) {
    try {
      await indexDocument({
        productId: '__policy__',
        docType: 'policy_faq',
        title: faq.title,
        content: faq.content,
        sourceRef: SOURCE_REF,
      });
      policyDocsCount++;
    } catch (err: any) {
      errors.push(`FAQ ${faq.title}: ${err.message}`);
      console.error(`[fixtures] FAQ error:`, err);
    }
  }

  // ── Review ingestion ──
  console.log('[fixtures] Running ingestProductReviews...');
  for (const p of products) {
    try {
      await ingestProductReviews(p.id);
    } catch (err: any) {
      errors.push(`Ingest ${p.id}: ${err.message}`);
      console.error(`[fixtures] Ingest ${p.id} error:`, err);
    }
  }

  const result = {
    products: products.length,
    specs: specsCount,
    reviews: reviewsCount,
    productDocs: productDocsCount,
    policyDocs: policyDocsCount,
    errors,
  };

  console.log('[fixtures] Done:', JSON.stringify(result));
  return result;
}
