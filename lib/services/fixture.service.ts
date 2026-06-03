'use server';

import { prisma } from '@/lib/rag/db';
import { PrismaClient } from '@/prisma/generated/prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { indexDocument, indexProductDetail } from '@/lib/services/index.service';
import { ingestProductReviews } from '@/lib/services/review-ingestion.service';

const SOURCE_REF = 'synthetic-rag-fixtures-v1';

// ── Spec templates by category ──

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
  {
    title: '退换货政策',
    content: `Q: 7天无理由退货怎么操作？
A: 签收后7天内，保持商品完好（未下水、吊牌完整、不影响二次销售），可直接在订单详情页申请退货。审核通过后系统会生成退货地址，寄回后3个工作日内退款。

Q: 退货后多久能收到退款？
A: 仓库签收退货后，退款会在1-3个工作日原路返回。支付宝/微信支付通常1个工作日内到账，银行卡支付需要3-5个工作日。

Q: 换货的流程是怎样的？
A: 先在订单页申请换货并注明原因，审核通过后寄回原商品。收到换货商品后，仓库会在2个工作日内发出新商品，来回运费由我们承担。

Q: 已经下水洗过的衣服还能退吗？
A: 很遗憾，已下水或洗涤过的商品无法办理退换货，因为影响了二次销售。建议试穿时保留吊牌，确认合适后再说洗唛。

Q: 吊牌拆了但没洗过能退吗？
A: 如果吊牌拆了但衣服没有穿着痕迹和洗涤痕迹，部分情况下可以协商退货。建议保留原包装，联系客服拍图确认后评估。

Q: 海外订单可以退货吗？
A: 目前退货流程仅支持中国大陆地址。海外订单如有质量问题可联系客服协商处理方案。`,
  },
  {
    title: '发货与物流',
    content: `Q: 下单后多久发货？
A: 工作日16:00前下单当天发出，之后次工作日发。周末和节假日顺延至下一个工作日。一般48小时内都会发出。

Q: 发什么快递？能指定吗？
A: 默认发中通/圆通/申通随机，满299发顺丰。如需指定快递请在订单备注，但可能产生额外费用。

Q: 多久能收到？
A: 江浙沪通常1-2天，其他地区3-5天，偏远地区5-7天。遇大促期物流可能延迟1-2天。

Q: 怎么查物流？
A: 发货后订单详情页会显示运单号，可直接点击追踪。如果长时间未更新，联系客服帮您核实。

Q: 快递丢失了怎么办？
A: 如果物流信息超过5天未更新，联系客服核实。确认丢失后我们会安排补发或全额退款，不需要您承担任何费用。`,
  },
  {
    title: '支付与发票',
    content: `Q: 支持哪些支付方式？
A: 支持微信支付、支付宝、银行卡支付、PayPal和Stripe（外币卡）。海外用户建议使用PayPal或Stripe。

Q: 可以开票吗？
A: 支持开具增值税普通发票和专用发票。下单时在备注里填写开票信息（单位名称+税号），电子发票会在确认收货后3个工作日内发到您的邮箱。

Q: 发票可以补开吗？
A: 订单完成后30天内可以联系客服补开发票。超过30天的订单可能无法补开，建议收货确认时及时申请。

Q: 付款后还可以修改订单吗？
A: 订单未发货前可以联系客服修改收货地址或尺码规格。已发货的订单不支持修改。

Q: 为什么付款失败了？
A: 可能原因：银行卡限额、信用卡授权失败、网络超时。建议更换支付方式或稍后再试。如果多次失败，联系客服排查。`,
  },
  {
    title: '售后与质量问题',
    content: `Q: 收到的衣服有质量问题怎么办？
A: 签收后48小时内拍照联系客服。质量问题（破洞、严重色差、开线、污渍等）我们承担来回运费退换。超过48小时的需说明原因。

Q: 什么算质量问题？
A: 明显的破洞/开线、严重色差（与商品页差异过大）、污渍、拉链损坏、扣子脱落。轻微色差、线头、褶皱不算质量问题。

Q: 穿了几次坏了能保修吗？
A: 目前不提供穿后保修。如果穿着后短期内出现非人为损坏（如正常穿着下开线），可以联系客服协商处理方案。

Q: 申请售后需要什么材料？
A: 需要提供：订单号、商品实物照片（清晰展示问题部位）、外包装照片、简要描述问题。材料齐全可以加快处理速度。

Q: 售后处理时效是多久？
A: 提交售后申请后24小时内客服会回复。确认为质量问题后，退换货流程通常3-5个工作日完成。`,
  },
  {
    title: '清洗与保养建议',
    content: `Q: 衣服怎么洗不容易变形？
A: 建议反面洗涤、使用洗衣袋、选择轻柔模式。水温不要超过30°C。棉质衣物洗后平铺晾干，不要用力拧干和暴晒。

Q: 深色衣服掉色怎么办？
A: 深色衣物（尤其是牛仔和黑色）首次洗涤建议用盐水浸泡30分钟固色。前几次单独洗涤，不要和浅色混洗。

Q: 衬衫怎么熨烫？
A: 棉质衬衫建议用蒸汽熨斗中温熨烫。先熨领子再熨袖口，然后熨前后片。熨烫前在衣服上喷少许水，效果更好。

Q: 羊毛/羊绒怎么保养？
A: 建议干洗或使用专用洗涤液手洗。不可机洗、不可拧干、不可暴晒。平铺晾干，存放时使用防蛀片。

Q: 白色衣服发黄了怎么办？
A: 可以用稀释的白醋或小苏打浸泡，再用彩漂液处理。日常穿着后及时清洗，不要久放不洗，汗渍会导致衣物发黄。`,
  },
];

// ── Main generator ──

const rawPrisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

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

function buildSpecJson(category: string, product: { name: string; brand: string }): Record<string, string> {
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
    size_advice: ['建议按正常尺码购买', '建议买小一码', '建议买大一码', '正常尺码，偏修身可选大一码'][randBetween(0, 3)],
    highlights: pickN(tpl.highlights, 3).join('；'),
    limitations: pickN(tpl.limitations, 2).join('；'),
  };
}

function generateReviews(product: { name: string; category: string }, count: number): string[] {
  const reviews: string[] = [];

  // Fit (2-4)
  const fitCount = randBetween(2, 4);
  for (let i = 0; i < fitCount; i++) {
    reviews.push(i === 0 ? pick(FIT_REVIEWS.negative) : pick(FIT_REVIEWS.positive));
  }

  // Fabric / comfort (2-4)
  const fabricCount = randBetween(2, 4);
  for (let i = 0; i < fabricCount; i++) {
    reviews.push(i < 2 ? pick(FABRIC_REVIEWS.positive) : pick(FABRIC_REVIEWS.negative));
  }

  // Color / workmanship (1-3)
  const cwCount = randBetween(1, 3);
  for (let i = 0; i < cwCount; i++) {
    reviews.push(pick(COLOR_WORKMANSHIP_REVIEWS));
  }

  // Noise (1-2) — logistics/customer service, tests cleaner
  const noiseCount = randBetween(1, 2);
  for (let i = 0; i < noiseCount; i++) {
    reviews.push(pick(NOISE_REVIEWS));
  }

  // Mixed (1-2)
  const mixedCount = randBetween(1, 2);
  for (let i = 0; i < mixedCount; i++) {
    reviews.push(pick(MIXED_REVIEWS));
  }

  // Shuffle and truncate to target count
  return reviews.sort(() => Math.random() - 0.5).slice(0, count);
}

export async function generateRagFixtures(): Promise<{
  products: number;
  specs: number;
  reviews: number;
  productDocs: number;
  policyDocs: number;
  errors: string[];
}> {
  const errors: string[] = [];

  console.log('[fixtures] Cleaning old synthetic data...');
  await rawPrisma.productSpec.deleteMany({ where: { id: { not: '' } } });

  // Clean synthetic documents + chunks
  const oldDocs = await prisma.knowledgeDocument.findMany({
    where: { sourceRef: SOURCE_REF },
    select: { id: true },
  });
  for (const d of oldDocs) {
    await prisma.knowledgeChunk.deleteMany({ where: { documentId: d.id } });
  }
  await prisma.knowledgeDocument.deleteMany({ where: { sourceRef: SOURCE_REF } });

  // Clean synthetic reviews (identified by a distinctive pattern in title)
  await prisma.reviewInsight.deleteMany({ where: { id: { not: '' } } });
  // We can't easily distinguish synthetic reviews from real ones via Prisma.
  // Use a simple heuristic: delete reviews with rating in title pattern.
  // For safety, delete ALL reviews (this is a test fixture tool).
  await rawPrisma.review.deleteMany({});

  console.log('[fixtures] Old data cleaned.');

  // ── Process products ──
  const products = await rawPrisma.product.findMany({ select: { id: true, name: true, category: true, brand: true, description: true } });
  console.log(`[fixtures] Processing ${products.length} products...`);

  let specsCount = 0;
  let reviewsCount = 0;
  let productDocsCount = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const tpl = SPEC_MAP[p.category] ?? SHIRT_SPECS;

    try {
      // 1. ProductSpec
      const specs = buildSpecJson(p.category, p);
      await rawPrisma.productSpec.upsert({
        where: { productId: p.id },
        create: { productId: p.id, specs },
        update: { specs },
      });
      specsCount++;

      // 2. KnowledgeDocument: product_detail (via indexDocument for chunk+embedding)
      const detailContent = buildProductDetailContent(p, specs);
      await indexDocument({
        productId: p.id,
        docType: 'product_detail',
        title: `${p.name} — 商品详情`,
        content: detailContent,
        sourceRef: SOURCE_REF,
      });
      productDocsCount++;

      // 3. Reviews: vary count to test both paths (some ≤4, some ≥6)
      const reviewCount = i < 2
        ? randBetween(3, 4)   // ≤ threshold → direct path
        : randBetween(6, 12); // > threshold → aggregate path
      const reviewTexts = generateReviews(p, reviewCount);

      for (let ri = 0; ri < reviewTexts.length; ri++) {
        await rawPrisma.review.create({
          data: {
            userId: '', // placeholder, will be set when real users exist
            productId: p.id,
            rating: randBetween(3, 5),
            title: `合成评测 #${ri + 1}`,
            description: reviewTexts[ri],
            isVerifiedPurchase: true,
          },
        });
        reviewsCount++;
      }
    } catch (err: any) {
      errors.push(`Product ${p.id}: ${err.message}`);
    }
  }

  // ── Policy FAQ documents (via indexDocument for chunking + embedding) ──
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
    }
  }

  // ── Review ingestion for each product ──
  console.log('[fixtures] Running ingestProductReviews for each product...');
  for (const p of products) {
    try {
      await ingestProductReviews(p.id);
    } catch (err: any) {
      errors.push(`Ingest ${p.id}: ${err.message}`);
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

  console.log('[fixtures] Done:', result);
  return result;
}

function buildProductDetailContent(
  product: { name: string; brand: string; category: string; description: string },
  specs: Record<string, string>,
): string {
  const sections = [
    `${product.name}`,
    `品牌：${product.brand}`,
    `类目：${product.category}`,
    ``,
    `商品描述：${product.description}`,
    ``,
    `规格参数：`,
    `- 材质：${specs.material}`,
    `- 版型：${specs.fit}`,
    `- 领型：${specs.collar}`,
    `- 袖长：${specs.sleeve_length}`,
    `- 厚度：${specs.thickness}`,
    `- 弹性：${specs.stretch}`,
    `- 透气性：${specs.breathability}`,
    `- 适用场景：${specs.occasion}`,
    `- 适用季节：${specs.season}`,
    ``,
    `亮点：${specs.highlights}`,
    ``,
    `注意事项：${specs.limitations}`,
    ``,
    `洗护建议：${specs.care_instructions}`,
    ``,
    `尺码建议：${specs.size_advice}`,
  ];

  return sections.join('\n');
}
