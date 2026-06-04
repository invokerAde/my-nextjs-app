-- Step 1: Merge ProductSpec.specs into KnowledgeDocument.metadata for product_detail docs
-- This copies spec attributes into the document metadata JSON
UPDATE "KnowledgeDocument" kd
SET metadata = kd.metadata::jsonb || jsonb_build_object(
  'specs', ps.specs::jsonb,
  'mergedFromSpecs', true
)
FROM "ProductSpec" ps
WHERE kd."productId" = ps."productId"
  AND kd."docType" = 'product_detail';

-- Step 2: Drop old views that depend on ProductSpec
DROP VIEW IF EXISTS product_search_view;

-- Step 3: Drop ProductSpec table and its constraints
ALTER TABLE "ProductSpec" DROP CONSTRAINT IF EXISTS "ProductSpec_productId_fkey";
DROP TABLE IF EXISTS "ProductSpec";

-- Step 4: Recreate product_search_view without ProductSpec join
-- Uses KnowledgeDocument.metadata for specs, compatible with existing Text2SQL queries
CREATE VIEW product_search_view AS
SELECT
  p.id,
  p.name,
  p.slug,
  p.category,
  p.brand,
  p.price::numeric,
  p.rating::numeric,
  p."numReviews",
  p.stock,
  p."isFeatured",
  COALESCE(
    (kd.metadata->>'specs')::text,
    '{}'
  ) AS specs_json
FROM "Product" p
LEFT JOIN "KnowledgeDocument" kd
  ON kd."productId" = p.id AND kd."docType" = 'product_detail';

-- Step 5: Update active_knowledge_chunk_view to expose product-level metadata fields
-- for metadata-filtered retrieval
DROP VIEW IF EXISTS active_knowledge_chunk_view;
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
