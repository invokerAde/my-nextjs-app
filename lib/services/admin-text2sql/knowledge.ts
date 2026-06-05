/**
 * Admin Text2SQL Knowledge Schema.
 * DDL, field descriptions, and Few-Shot examples for the 4 analytics views.
 */

// ── Whitelist views ──

export const ANALYTICS_VIEWS = [
  'admin_product_analytics_view',
  'admin_order_analytics_view',
  'admin_review_analytics_view',
  'admin_customer_summary_view',
] as const;

export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number];

// ── DDL ──

export const VIEW_DDL: Record<AnalyticsView, string> = {
  admin_product_analytics_view: `CREATE VIEW admin_product_analytics_view AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.slug,
  p.category,
  p.brand,
  p.price::numeric AS price,
  p.rating::numeric AS rating,
  p."numReviews" AS review_count,
  p.stock,
  p."isFeatured" AS is_featured,
  p."createdAt" AS created_at
FROM "Product" p`,

  admin_order_analytics_view: `CREATE VIEW admin_order_analytics_view AS
SELECT
  o.id AS order_id,
  o."userId" AS user_id,
  o."isPaid" AS is_paid,
  o."paidAt" AS paid_at,
  o."isDelivered" AS is_delivered,
  o."deliveredAt" AS delivered_at,
  o."createdAt" AS order_created_at,
  oi."productId" AS product_id,
  oi.name AS product_name,
  oi.slug AS product_slug,
  oi.qty AS quantity,
  oi.price::numeric AS unit_price,
  (oi.qty * oi.price)::numeric AS line_total,
  p.category AS product_category,
  p.brand AS product_brand
FROM "Order" o
JOIN "OrderItem" oi ON oi."orderId" = o.id
LEFT JOIN "Product" p ON p.id = oi."productId"`,

  admin_review_analytics_view: `CREATE VIEW admin_review_analytics_view AS
SELECT
  r.id AS review_id,
  r."productId" AS product_id,
  r."userId" AS user_id,
  r.rating,
  r.title,
  r.description,
  r."isVerifiedPurchase" AS is_verified_purchase,
  r."createdAt" AS review_created_at,
  p.name AS product_name,
  p.slug AS product_slug,
  p.category AS product_category,
  p.brand AS product_brand
FROM "Review" r
JOIN "Product" p ON p.id = r."productId"`,

  admin_customer_summary_view: `CREATE VIEW admin_customer_summary_view AS
SELECT
  u.id AS user_id,
  u.role,
  u."createdAt" AS registered_at,
  COUNT(DISTINCT o.id)::int AS order_count,
  COALESCE(SUM(oi.qty * oi.price)::numeric, 0) AS total_spent,
  COALESCE(SUM(CASE WHEN o."isPaid" THEN oi.qty * oi.price ELSE 0 END)::numeric, 0) AS paid_spent,
  COALESCE(SUM(CASE WHEN o."isDelivered" THEN oi.qty * oi.price ELSE 0 END)::numeric, 0) AS delivered_spent,
  u.name,
  u.email
FROM "User" u
LEFT JOIN "Order" o ON o."userId" = u.id
LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id
GROUP BY u.id, u.role, u."createdAt", u.name, u.email`,
};

// ── Field descriptions ──

export interface FieldDescription {
  view: AnalyticsView;
  field: string;
  description: string;
}

export const FIELD_DESCRIPTIONS: FieldDescription[] = [
  // product
  { view: 'admin_product_analytics_view', field: 'product_id', description: '商品唯一 ID' },
  { view: 'admin_product_analytics_view', field: 'product_name', description: '商品名称' },
  { view: 'admin_product_analytics_view', field: 'slug', description: 'URL 友好标识' },
  { view: 'admin_product_analytics_view', field: 'category', description: '商品类目' },
  { view: 'admin_product_analytics_view', field: 'brand', description: '品牌' },
  { view: 'admin_product_analytics_view', field: 'price', description: '价格（元）' },
  { view: 'admin_product_analytics_view', field: 'rating', description: '评分（0-5）' },
  { view: 'admin_product_analytics_view', field: 'review_count', description: '评价数量' },
  { view: 'admin_product_analytics_view', field: 'stock', description: '库存数量' },
  { view: 'admin_product_analytics_view', field: 'is_featured', description: '是否精选推荐' },
  { view: 'admin_product_analytics_view', field: 'created_at', description: '商品上架时间' },
  // order
  { view: 'admin_order_analytics_view', field: 'order_id', description: '订单 ID' },
  { view: 'admin_order_analytics_view', field: 'user_id', description: '用户 ID' },
  { view: 'admin_order_analytics_view', field: 'is_paid', description: '是否已支付' },
  { view: 'admin_order_analytics_view', field: 'paid_at', description: '支付时间' },
  { view: 'admin_order_analytics_view', field: 'is_delivered', description: '是否已发货/交付' },
  { view: 'admin_order_analytics_view', field: 'delivered_at', description: '交付时间' },
  { view: 'admin_order_analytics_view', field: 'order_created_at', description: '订单创建时间' },
  { view: 'admin_order_analytics_view', field: 'product_id', description: '订单项商品 ID' },
  { view: 'admin_order_analytics_view', field: 'product_name', description: '订单项商品名称' },
  { view: 'admin_order_analytics_view', field: 'product_slug', description: '订单项商品 slug' },
  { view: 'admin_order_analytics_view', field: 'quantity', description: '购买数量' },
  { view: 'admin_order_analytics_view', field: 'unit_price', description: '购买时单价' },
  { view: 'admin_order_analytics_view', field: 'line_total', description: '行总计（数量×单价）' },
  { view: 'admin_order_analytics_view', field: 'product_category', description: '订单商品类目' },
  { view: 'admin_order_analytics_view', field: 'product_brand', description: '订单商品品牌' },
  // review
  { view: 'admin_review_analytics_view', field: 'review_id', description: '评论 ID' },
  { view: 'admin_review_analytics_view', field: 'product_id', description: '被评论商品 ID' },
  { view: 'admin_review_analytics_view', field: 'user_id', description: '评论用户 ID' },
  { view: 'admin_review_analytics_view', field: 'rating', description: '评分（1-5 整数）' },
  { view: 'admin_review_analytics_view', field: 'title', description: '评论标题' },
  { view: 'admin_review_analytics_view', field: 'description', description: '评论正文内容' },
  { view: 'admin_review_analytics_view', field: 'is_verified_purchase', description: '是否验证购买' },
  { view: 'admin_review_analytics_view', field: 'review_created_at', description: '评论创建时间' },
  { view: 'admin_review_analytics_view', field: 'product_name', description: '被评论商品名称' },
  { view: 'admin_review_analytics_view', field: 'product_slug', description: '被评论商品 slug' },
  { view: 'admin_review_analytics_view', field: 'product_category', description: '被评论商品类目' },
  { view: 'admin_review_analytics_view', field: 'product_brand', description: '被评论商品品牌' },
  // customer
  { view: 'admin_customer_summary_view', field: 'user_id', description: '用户 ID' },
  { view: 'admin_customer_summary_view', field: 'name', description: '用户名称' },
  { view: 'admin_customer_summary_view', field: 'email', description: '用户邮箱' },
  { view: 'admin_customer_summary_view', field: 'role', description: '用户角色（user/admin）' },
  { view: 'admin_customer_summary_view', field: 'registered_at', description: '注册时间' },
  { view: 'admin_customer_summary_view', field: 'order_count', description: '累计订单数' },
  { view: 'admin_customer_summary_view', field: 'total_spent', description: '累计消费总额（元）' },
  { view: 'admin_customer_summary_view', field: 'paid_spent', description: '已支付金额（元）' },
  { view: 'admin_customer_summary_view', field: 'delivered_spent', description: '已交付金额（元）' },
];

// ── Few-Shot examples (20+) ──

export interface FewShotExample {
  question: string;
  sql: string;
}

export const FEW_SHOT_EXAMPLES: FewShotExample[] = [
  // ── Product / Category ──
  {
    question: '评分最高的5款商品是什么？',
    sql: `SELECT product_name, category, brand, price, rating, review_count
FROM admin_product_analytics_view
ORDER BY rating DESC, review_count DESC
LIMIT 5`,
  },
  {
    question: '每个类目有多少商品、平均价格和平均评分？',
    sql: `SELECT category, COUNT(*)::int AS product_count,
       ROUND(AVG(price), 2) AS avg_price,
       ROUND(AVG(rating), 2) AS avg_rating
FROM admin_product_analytics_view
GROUP BY category
ORDER BY product_count DESC`,
  },
  {
    question: '库存低于10件的商品有哪些？',
    sql: `SELECT product_name, category, brand, stock, price
FROM admin_product_analytics_view
WHERE stock < 10
ORDER BY stock ASC
LIMIT 20`,
  },
  {
    question: '哪个品牌的商品数量最多？',
    sql: `SELECT brand, COUNT(*)::int AS product_count,
       ROUND(AVG(rating), 2) AS avg_rating
FROM admin_product_analytics_view
GROUP BY brand
ORDER BY product_count DESC
LIMIT 10`,
  },
  {
    question: '最近上架的5件商品是什么？',
    sql: `SELECT product_name, category, brand, price, created_at
FROM admin_product_analytics_view
ORDER BY created_at DESC
LIMIT 5`,
  },
  // ── Order / Sales ──
  {
    question: '最近30天的销售额趋势（按天）？',
    sql: `SELECT DATE(order_created_at) AS order_date,
       SUM(line_total) AS daily_revenue,
       COUNT(DISTINCT order_id)::int AS order_count
FROM admin_order_analytics_view
WHERE order_created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(order_created_at)
ORDER BY order_date`,
  },
  {
    question: '销售额最高的前10款商品？',
    sql: `SELECT product_name, product_category, product_brand,
       SUM(quantity)::int AS total_sold,
       SUM(line_total) AS total_revenue
FROM admin_order_analytics_view
WHERE is_paid = true
GROUP BY product_id, product_name, product_category, product_brand
ORDER BY total_revenue DESC
LIMIT 10`,
  },
  {
    question: '各品牌的销售额排名？',
    sql: `SELECT product_brand,
       SUM(line_total) AS total_revenue,
       SUM(quantity)::int AS total_units,
       COUNT(DISTINCT order_id)::int AS order_count
FROM admin_order_analytics_view
WHERE is_paid = true
GROUP BY product_brand
ORDER BY total_revenue DESC`,
  },
  {
    question: '待支付的订单有多少、总金额是多少？',
    sql: `SELECT COUNT(DISTINCT order_id)::int AS unpaid_order_count,
       SUM(line_total) AS unpaid_amount
FROM admin_order_analytics_view
WHERE is_paid = false`,
  },
  {
    question: '已发货但未支付的订单有多少？',
    sql: `SELECT COUNT(DISTINCT order_id)::int AS delivered_unpaid_count,
       SUM(line_total) AS at_risk_amount
FROM admin_order_analytics_view
WHERE is_delivered = true AND is_paid = false`,
  },
  {
    question: '本月每个类目的销售额占比？',
    sql: `SELECT product_category,
       SUM(line_total) AS category_revenue,
       ROUND(SUM(line_total) * 100.0 / SUM(SUM(line_total)) OVER(), 1) AS revenue_pct
FROM admin_order_analytics_view
WHERE is_paid = true
  AND order_created_at >= date_trunc('month', NOW())
GROUP BY product_category
ORDER BY category_revenue DESC`,
  },
  // ── Review ──
  {
    question: '差评最多的5款商品（平均评分最低）？',
    sql: `SELECT product_name, product_category, product_brand,
       ROUND(AVG(rating), 2) AS avg_rating,
       COUNT(*)::int AS review_count
FROM admin_review_analytics_view
GROUP BY product_id, product_name, product_category, product_brand
HAVING COUNT(*) >= 3
ORDER BY avg_rating ASC
LIMIT 5`,
  },
  {
    question: '验证购买的用户评论占比是多少？',
    sql: `SELECT
  COUNT(*)::int AS total_reviews,
  COUNT(*) FILTER (WHERE is_verified_purchase)::int AS verified_reviews,
  ROUND(COUNT(*) FILTER (WHERE is_verified_purchase) * 100.0 / COUNT(*), 1) AS verified_pct
FROM admin_review_analytics_view`,
  },
  {
    question: '每周评论数量趋势？',
    sql: `SELECT DATE_TRUNC('week', review_created_at) AS review_week,
       COUNT(*)::int AS review_count,
       ROUND(AVG(rating), 2) AS avg_rating
FROM admin_review_analytics_view
WHERE review_created_at >= NOW() - INTERVAL '12 weeks'
GROUP BY review_week
ORDER BY review_week`,
  },
  {
    question: '评分分布（1-5分各多少条）？',
    sql: `SELECT rating, COUNT(*)::int AS review_count
FROM admin_review_analytics_view
GROUP BY rating
ORDER BY rating`,
  },
  // ── Customer ──
  {
    question: '下单数超过5单的客户有哪些？',
    sql: `SELECT name, email, registered_at, order_count, total_spent
FROM admin_customer_summary_view
WHERE order_count > 5
ORDER BY order_count DESC
LIMIT 20`,
  },
  {
    question: '消费最高的10个用户的消费总额？',
    sql: `SELECT name, email, order_count, total_spent, paid_spent
FROM admin_customer_summary_view
ORDER BY total_spent DESC
LIMIT 10`,
  },
  {
    question: '有订单的用户的平均消费金额？',
    sql: `SELECT ROUND(AVG(total_spent), 2) AS avg_customer_spend,
       ROUND(AVG(order_count), 1) AS avg_orders
FROM admin_customer_summary_view
WHERE order_count > 0`,
  },
  {
    question: '本月新增了多少用户？',
    sql: `SELECT COUNT(*)::int AS new_users
FROM admin_customer_summary_view
WHERE registered_at >= date_trunc('month', NOW())`,
  },
  // ── Cross-view ──
  {
    question: '评分最高但销量最低的商品？',
    sql: `SELECT p.product_name, p.category, p.brand, p.rating,
       COALESCE(SUM(o.quantity)::int, 0) AS total_sold
FROM admin_product_analytics_view p
LEFT JOIN admin_order_analytics_view o ON o.product_id = p.product_id
GROUP BY p.product_id, p.product_name, p.category, p.brand, p.rating
HAVING p.rating >= 4.0
ORDER BY total_sold ASC
LIMIT 10`,
  },
  {
    question: '有差评但仍在架销售的商品？',
    sql: `SELECT DISTINCT p.product_name, p.category, p.brand,
       p.rating AS product_rating,
       p.stock
FROM admin_product_analytics_view p
JOIN admin_review_analytics_view r ON r.product_id = p.product_id
WHERE p.stock > 0 AND r.rating <= 2
ORDER BY p.rating ASC
LIMIT 10`,
  },
];
