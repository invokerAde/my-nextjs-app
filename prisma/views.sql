CREATE VIEW product_search_view AS
SELECT
  p.id,
  p.name,
  p.slug,
  p.category,
  p.brand,
  p.price::numeric,
  p.rating::numeric,
  "numReviews",
  p.stock,
  "isFeatured",
  COALESCE(ps.specs::text, '{}') AS specs_json
FROM "Product" p
LEFT JOIN "ProductSpec" ps ON ps."productId" = p.id;

CREATE VIEW active_knowledge_chunk_view AS
SELECT
  kc.id,
  kc."documentId",
  kc."chunkIndex",
  kc.content,
  kc.embedding,
  kc.tsvector,
  kc.metadata,
  kd."productId",
  kd."docType",
  kd.title
FROM "KnowledgeChunk" kc
JOIN "KnowledgeDocument" kd ON kd.id = kc."documentId"
WHERE kc."isActive" = true;
