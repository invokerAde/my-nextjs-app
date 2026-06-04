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
  COALESCE(
    (kd.metadata->>'specs')::text,
    '{}'
  ) AS specs_json
FROM "Product" p
LEFT JOIN "KnowledgeDocument" kd
  ON kd."productId" = p.id AND kd."docType" = 'product_detail';

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
  kd.title,
  kd.metadata AS "documentMetadata",
  kd.version
FROM "KnowledgeChunk" kc
JOIN "KnowledgeDocument" kd ON kd.id = kc."documentId"
WHERE kc."isActive" = true;
