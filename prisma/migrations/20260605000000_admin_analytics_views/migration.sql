-- Admin analytics views: safe aggregation views for Text2SQL queries.
-- All views join with Product for category/brand/price context.
-- Raw sensitive tables (User password/address, Payment details) are excluded.

-- 1. Product analytics (price, rating, stock, category, brand)
CREATE VIEW admin_product_analytics_view AS
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
FROM "Product" p;

-- 2. Order analytics (order items + product context, payment/delivery status, time)
CREATE VIEW admin_order_analytics_view AS
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
LEFT JOIN "Product" p ON p.id = oi."productId";

-- 3. Review analytics (rating, verified purchase, product context, time)
CREATE VIEW admin_review_analytics_view AS
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
JOIN "Product" p ON p.id = r."productId";

-- 4. Customer summary (aggregated, no PII)
CREATE VIEW admin_customer_summary_view AS
SELECT
  u.id AS user_id,
  u.role,
  u."createdAt" AS registered_at,
  COUNT(DISTINCT o.id)::int AS order_count,
  COALESCE(SUM(oi.qty * oi.price)::numeric, 0) AS total_spent,
  COALESCE(SUM(CASE WHEN o."isPaid" THEN oi.qty * oi.price ELSE 0 END)::numeric, 0) AS paid_spent,
  COALESCE(SUM(CASE WHEN o."isDelivered" THEN oi.qty * oi.price ELSE 0 END)::numeric, 0) AS delivered_spent
FROM "User" u
LEFT JOIN "Order" o ON o."userId" = u.id
LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id
GROUP BY u.id, u.role, u."createdAt";
