'use server';

import { prisma } from '@/lib/rag/db';
import { chunkDocument } from '@/lib/rag/chunker';
import { computeDocHash } from '@/lib/rag/hasher';
import { isEmbeddingConfigured } from '@/lib/services/embedding.service';

export interface IndexDocumentParams {
  productId: string;
  docType: string;
  title: string;
  content: string;
  sourceRef?: string;
}

/**
 * 索引单个文档：chunk → embedding → tsvector → 写入 chunk。
 * 内容未变时跳过（基于 docHash）。
 */
export async function indexDocument(params: IndexDocumentParams): Promise<{
  action: 'created' | 'updated' | 'skipped';
  docId: string;
}> {
  const docHash = computeDocHash(params.content);

  // 检查是否有未变的已激活文档
  const existing = await prisma.knowledgeDocument.findFirst({
    where: { productId: params.productId, docType: params.docType, docHash },
    include: { chunks: { where: { isActive: true }, take: 1 } },
  });

  if (existing && existing.chunks.length > 0) {
    return { action: 'skipped', docId: existing.id };
  }

  // 旧版本 deactivate
  await prisma.knowledgeChunk.updateMany({
    where: {
      document: { productId: params.productId, docType: params.docType },
      isActive: true,
    },
    data: { isActive: false },
  });

  // 计算版本号
  const maxVersion = await prisma.knowledgeDocument.aggregate({
    _max: { version: true },
    where: { productId: params.productId, docType: params.docType },
  });
  const version = (maxVersion._max.version ?? 0) + 1;

  // 创建 document
  const doc = await prisma.knowledgeDocument.create({
    data: {
      productId: params.productId,
      docType: params.docType,
      docHash,
      title: params.title,
      version,
      sourceRef: params.sourceRef,
    },
  });

  // chunk
  const chunks = chunkDocument(params.content);

  // 批量生成 embedding
  const embeddings = await generateEmbeddingsIfConfigured(chunks.map(c => c.content));

  // 写入 chunk (含 embedding + tsvector)
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const embedding = embeddings?.[i];

    await prisma.$executeRawUnsafe(
      `INSERT INTO "KnowledgeChunk" (id, "documentId", "chunkIndex", content, "tokenCount", metadata, embedding, tsvector, "isActive", version, "createdAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::vector, to_tsvector('simple', $7), true, $8, NOW())`,
      doc.id,
      c.index,
      c.content,
      c.tokenCount,
      JSON.stringify(c.metadata),
      embedding ? pgVectorLiteral(embedding) : null,
      buildTsvectorInput(c.content),
      version,
    );
  }

  // 异步清理旧版本
  deleteOldVersions(params.productId, params.docType, doc.id).catch(err =>
    console.error('Old version cleanup failed:', err),
  );

  return { action: existing ? 'updated' : 'created', docId: doc.id };
}

/**
 * 从商品详情生成知识文档并索引
 */
export async function indexProductDetail(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product) throw new Error(`Product ${productId} not found`);

  const content = [
    `商品名称: ${product.name}`,
    `品牌: ${product.brand}`,
    `类目: ${product.category}`,
    `描述: ${product.description}`,
  ].join('\n');

  await indexDocument({ productId, docType: 'product_detail', title: product.name, content });
}

/**
 * 回填所有已有商品的索引。
 * 可在首次部署或手动恢复时调用，也可通过 admin UI 触发。
 */
export async function backfillAllProducts(): Promise<{
  total: number;
  indexed: number;
  skipped: number;
  errors: string[];
}> {
  const products = await prisma.product.findMany({ select: { id: true } });

  let indexed = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const p of products) {
    try {
      const result = await indexProductDetail(p.id);
      if (result !== undefined) {
        // indexProductDetail doesn't return a result, we call indexDocument indirectly
        indexed++;
      }
    } catch (err: any) {
      errors.push(`${p.id}: ${err.message}`);
    }
  }

  // 更准确计数：重新查询 knowledge_document
  const docCount = await prisma.knowledgeDocument.count({
    where: { docType: 'product_detail' },
  });

  return { total: products.length, indexed: docCount, skipped: products.length - docCount, errors };
}

/**
 * 手动强制重建指定商品的索引（忽略 docHash 检查）。
 */
export async function forceReindexProduct(productId: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    // 清除旧数据
    const oldDocs = await prisma.knowledgeDocument.findMany({
      where: { productId },
      select: { id: true },
    });
    for (const od of oldDocs) {
      await prisma.knowledgeChunk.deleteMany({ where: { documentId: od.id } });
      await prisma.knowledgeDocument.delete({ where: { id: od.id } });
    }

    // 重建
    await indexProductDetail(productId);
    return { success: true, message: `Product ${productId} reindexed` };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

// ── helpers ──

async function generateEmbeddingsIfConfigured(texts: string[]): Promise<number[][] | null> {
  if (!isEmbeddingConfigured()) return null;

  try {
    const { generateEmbeddings } = await import('@/lib/services/embedding.service');
    return await generateEmbeddings(texts);
  } catch (err) {
    console.error('[index] Embedding generation failed, chunks will lack vectors:', err);
    return null;
  }
}

function pgVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

function buildTsvectorInput(content: string): string {
  return content
    .replace(/[^\w一-鿿\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

async function deleteOldVersions(
  productId: string,
  docType: string,
  keepDocId: string,
): Promise<void> {
  const oldDocs = await prisma.knowledgeDocument.findMany({
    where: { productId, docType, id: { not: keepDocId } },
    select: { id: true },
  });
  for (const od of oldDocs) {
    await prisma.knowledgeChunk.deleteMany({ where: { documentId: od.id } });
    await prisma.knowledgeDocument.delete({ where: { id: od.id } });
  }
}
