CREATE INDEX IF NOT EXISTS idx_kc_tsvector_gin
ON "KnowledgeChunk" USING GIN (tsvector);

CREATE INDEX IF NOT EXISTS idx_kc_embedding_hnsw
ON "KnowledgeChunk" USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 200);

CREATE INDEX IF NOT EXISTS idx_kc_doc_active
ON "KnowledgeChunk" ("documentId", "isActive");

CREATE INDEX IF NOT EXISTS idx_ps_product_id
ON "ProductSpec" ("productId");

CREATE INDEX IF NOT EXISTS idx_ri_product_version
ON "ReviewInsight" ("productId", version);
