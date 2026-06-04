export type IntentType =
  | 'product_filter'
  | 'product_detail'
  | 'review_insight'
  | 'policy_faq'
  | 'realtime_price_stock'
  | 'hybrid';

export interface IntentResult {
  intents: IntentType[];
  entities: {
    productIds?: string[];
    categories?: string[];
    brand?: string;
    attributes?: Record<string, string[]>;
    priceRange?: { min?: number; max?: number };
    comparisonTarget?: string;
  };
  isTimeSensitive: boolean;
}

const TIMESENSITIVE_KEYWORDS = [
  '多少钱', '价格', '优惠', '打折', '促销', '有货吗',
  '库存', 'M码', 'L码', 'XL码', 'S码', '还有吗',
  '现在', '目前', '当前', '实时', '最新价',
];

const FILTER_KEYWORDS = [
  '推荐', '有什么', '哪些', '哪款', '比较', '对比', '哪个好',
  '以内', '以下', '以上', '不超过', '最好', '排行', '热门',
];

const DETAIL_KEYWORDS = [
  '材质', '面料', '描述', '详情', '规格', '参数', '尺寸',
  '成分', '适用', '怎么洗', '保养',
];

const REVIEW_KEYWORDS = [
  '评价', '评论', '口碑', '反馈', '体验', '买家说', '用户',
  '偏大', '偏小', '起球', '褪色', '缩水', '透气', '舒适度',
];

const FAQ_KEYWORDS = [
  '退货', '换货', '退款', '发货', '运费', '保修', '政策', '规则',
  '多久', '几天', '怎么退', '能不能退',
];

export function classifyIntent(query: string): IntentResult {
  const isTimeSensitive = TIMESENSITIVE_KEYWORDS.some(k => query.includes(k));
  const hasFilter = FILTER_KEYWORDS.some(k => query.includes(k));
  const hasDetail = DETAIL_KEYWORDS.some(k => query.includes(k));
  const hasReview = REVIEW_KEYWORDS.some(k => query.includes(k));
  const hasFAQ = FAQ_KEYWORDS.some(k => query.includes(k));

  const intents: IntentType[] = [];

  if (isTimeSensitive) intents.push('realtime_price_stock');
  if (hasFilter) intents.push('product_filter');
  if (hasDetail) intents.push('product_detail');
  if (hasReview) intents.push('review_insight');
  if (hasFAQ) intents.push('policy_faq');

  if (intents.length === 0) intents.push('hybrid');

  return { intents, entities: {}, isTimeSensitive };
}
