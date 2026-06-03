-- Enable pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "ProductSpec" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "productId" UUID NOT NULL,
    "specs" JSON NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "productId" UUID,
    "docType" TEXT NOT NULL,
    "docHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceRef" TEXT,
    "metadata" JSON NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "documentId" UUID NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER,
    "metadata" JSON NOT NULL DEFAULT '{}',
    "embedding" vector(1536),
    "tsvector" tsvector,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewInsight" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "productId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSON NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_specs_productId_idx" ON "ProductSpec"("productId");

-- CreateIndex
CREATE INDEX "kd_productId_idx" ON "KnowledgeDocument"("productId");

-- CreateIndex
CREATE INDEX "kd_docType_idx" ON "KnowledgeDocument"("docType");

-- CreateIndex
CREATE INDEX "kd_docHash_idx" ON "KnowledgeDocument"("docHash");

-- CreateIndex
CREATE INDEX "kc_documentId_idx" ON "KnowledgeChunk"("documentId");

-- CreateIndex
CREATE INDEX "kc_isActive_idx" ON "KnowledgeChunk"("isActive");

-- CreateIndex
CREATE INDEX "ri_productId_version_idx" ON "ReviewInsight"("productId", "version");

-- AddForeignKey
ALTER TABLE "ProductSpec" ADD CONSTRAINT "ProductSpec_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewInsight" ADD CONSTRAINT "ReviewInsight_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateViews
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

-- CreateIndex (performance-critical: GIN for FTS, HNSW for vector search)
CREATE INDEX IF NOT EXISTS idx_kc_tsvector_gin
ON "KnowledgeChunk" USING GIN (tsvector);

CREATE INDEX IF NOT EXISTS idx_kc_embedding_hnsw
ON "KnowledgeChunk" USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 200);

CREATE INDEX IF NOT EXISTS idx_kc_doc_active
ON "KnowledgeChunk" ("documentId", "isActive");
