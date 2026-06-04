'use server';

import { prisma } from '@/lib/rag/db';
import { chunkDocument } from '@/lib/rag/chunker';
import { computeDocHash } from '@/lib/rag/hasher';
import { isEmbeddingConfigured } from '@/lib/services/embedding.service';
import { extractAttributes, HardAttributes } from '@/lib/services/attribute-extractor.service';

export interface IndexDocumentParams {
  productId: string | null;
  docType: string;
  title: string;
  content: string;
  sourceRef?: string;
  /** 覆盖默认的 (productId, docType) 分组去重键，用于 policy FAQ 等多文档同类型场景 */
  groupKey?: string;
  /** 写入 KnowledgeDocument.metadata 的元数据 */
  metadata?: Record<string, unknown>;
  /** 写入每个 KnowledgeChunk.metadata 的基础元数据（会合并到 chunk 自身 metadata） */
  baseChunkMetadata?: Record<string, unknown>;
}

/** Product metadata written to KnowledgeDocument.metadata and chunk metadata for filtering */
export interface ProductMetadata {
  productId: string;
  name: string;
  slug: string;
  category: string;
  brand: string;
  price: number;
  rating: number;
  numReviews: number;
  stock: number;
  isFeatured: boolean;
  images: string[];
  // Hard attributes extracted from specs/text
  material?: string;
  fit?: string;
  collar?: string;
  sleeveLength?: string;
  thickness?: string;
  stretch?: string;
  breathability?: string;
  season?: string;
  scene?: string;
  sizeAdvice?: string;
  /** Raw specs preserved from migration/reindex, ensures rebuilds don't lose data */
  specs?: Record<string, unknown>;
}

/**
 * 索引单个文档：chunk → embedding → tsvector → 写入 chunk。
 * 内容未变时跳过（基于 docHash）。
 * 默认按 (productId, docType) 分组去重；传 groupKey 时按 groupKey 分组。
 */
export async function indexDocument(params: IndexDocumentParams): Promise<{
  action: 'created' | 'updated' | 'skipped';
  docId: string;
}> {
  const docHash = computeDocHash(params.content);

  // 检查是否有未变的已激活文档
  const existing = await prisma.knowledgeDocument.findFirst({
    where: { productId: params.productId as any, docType: params.docType, docHash },
    include: { chunks: { where: { isActive: true }, take: 1 } },
  });

  if (existing && existing.chunks.length > 0) {
    return { action: 'skipped', docId: existing.id };
  }

  // 旧版本 deactivate（按分组键，默认 productId+docType）
  const dedupeFilter = params.groupKey
    ? { document: { sourceRef: params.groupKey } }
    : { document: { productId: params.productId as any, docType: params.docType } };

  await prisma.knowledgeChunk.updateMany({
    where: { ...dedupeFilter, isActive: true },
    data: { isActive: false },
  });

  // 计算版本号（按分组键聚合）
  const versionWhere = params.groupKey
    ? { sourceRef: params.groupKey }
    : { productId: params.productId as any, docType: params.docType };
  const maxVersion = await prisma.knowledgeDocument.aggregate({
    _max: { version: true },
    where: versionWhere,
  });
  const version = (maxVersion._max.version ?? 0) + 1;

  // 创建 document（带 metadata）
  const doc = await prisma.knowledgeDocument.create({
    data: {
      productId: params.productId as any,
      docType: params.docType,
      docHash,
      title: params.title,
      version,
      sourceRef: params.sourceRef,
      metadata: (params.metadata || {}) as any,
    },
  });

  // chunk（传入 baseChunkMetadata 合并到每个 chunk）
  const chunkOptions = params.baseChunkMetadata
    ? { baseMetadata: params.baseChunkMetadata }
    : undefined;
  const chunks = chunkDocument(params.content, chunkOptions);

  // 批量生成 embedding
  const embeddings = await generateEmbeddingsIfConfigured(chunks.map(c => c.content));

  // 写入 chunk (含 embedding + tsvector)
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const embedding = embeddings?.[i];

    // 合并 baseChunkMetadata 到 chunk metadata
    const chunkMetadata = params.baseChunkMetadata
      ? { ...params.baseChunkMetadata, ...c.metadata }
      : c.metadata;

    await prisma.$executeRawUnsafe(
      `INSERT INTO "KnowledgeChunk" (id, "documentId", "chunkIndex", content, "tokenCount", metadata, embedding, tsvector, "isActive", version, "createdAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::vector, to_tsvector('simple', $7), true, $8, NOW())`,
      doc.id,
      c.index,
      c.content,
      c.tokenCount,
      JSON.stringify(chunkMetadata),
      embedding ? pgVectorLiteral(embedding) : null,
      buildTsvectorInput(c.content),
      version,
    );
  }

  // 异步清理旧版本
  if (params.groupKey) {
    deleteOldVersions({ sourceRef: params.groupKey }, doc.id).catch(err =>
      console.error('Old version cleanup failed:', err),
    );
  } else {
    deleteOldVersions({ productId: params.productId as any, docType: params.docType }, doc.id).catch(err =>
      console.error('Old version cleanup failed:', err),
    );
  }

  return { action: existing ? 'updated' : 'created', docId: doc.id };
}

/**
 * 从商品详情生成知识文档并索引。
 * 内容 = Product 基础信息 + 描述 + specs 文本。
 * metadata = Product 字段 + 硬指标抽取结果 + 原始 specs。
 *
 * @param productId 商品 ID
 * @param specs 可选，外部缓存的原始规格数据（先删后建场景下避免读已删除的旧数据）
 */
export async function indexProductDetail(
  productId: string,
  specs?: Record<string, unknown>,
): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product) throw new Error(`Product ${productId} not found`);

  // Specs 来源优先级: 外部传入 > 已有 KnowledgeDocument.metadata.specs
  let existingSpecs: Record<string, unknown> | undefined = specs;
  if (!existingSpecs) {
    try {
      const existingDoc = await prisma.knowledgeDocument.findFirst({
        where: { productId: productId as any, docType: 'product_detail' },
        orderBy: { version: 'desc' },
        select: { metadata: true },
      });
      if (existingDoc?.metadata && typeof existingDoc.metadata === 'object') {
        const meta = existingDoc.metadata as Record<string, unknown>;
        if (meta.specs && typeof meta.specs === 'object') {
          existingSpecs = meta.specs as Record<string, unknown>;
        }
      }
    } catch {
      // No existing doc — fine
    }
  }

  const price = Number(product.price);
  const rating = Number(product.rating);

  // Build full product detail text
  const parts: string[] = [
    `商品名称: ${product.name}`,
    `品牌: ${product.brand}`,
    `类目: ${product.category}`,
    '',
    `商品描述: ${product.description}`,
  ];

  if (existingSpecs) {
    parts.push('');
    parts.push('规格参数：');
    if (existingSpecs.material) parts.push(`- 材质：${existingSpecs.material}`);
    if (existingSpecs.fit) parts.push(`- 版型：${existingSpecs.fit}`);
    if (existingSpecs.collar) parts.push(`- 领型：${existingSpecs.collar}`);
    if (existingSpecs.sleeve_length) parts.push(`- 袖长：${existingSpecs.sleeve_length}`);
    if (existingSpecs.thickness) parts.push(`- 厚度：${existingSpecs.thickness}`);
    if (existingSpecs.stretch) parts.push(`- 弹性：${existingSpecs.stretch}`);
    if (existingSpecs.breathability) parts.push(`- 透气性：${existingSpecs.breathability}`);
    if (existingSpecs.occasion) parts.push(`- 适用场景：${existingSpecs.occasion}`);
    if (existingSpecs.season) parts.push(`- 适用季节：${existingSpecs.season}`);
    if (existingSpecs.highlights) parts.push(`亮点：${existingSpecs.highlights}`);
    if (existingSpecs.limitations) parts.push(`注意事项：${existingSpecs.limitations}`);
    if (existingSpecs.care_instructions) parts.push(`洗护建议：${existingSpecs.care_instructions}`);
    if (existingSpecs.size_advice) parts.push(`尺码建议：${existingSpecs.size_advice}`);
  }

  const content = parts.join('\n');

  // Extract hard attributes from content + specs
  const hardAttrs = extractAttributes(content, existingSpecs);

  // Build product metadata for filtering (includes raw specs for rebuild safety)
  const productMetadata: ProductMetadata = {
    productId,
    name: product.name,
    slug: product.slug,
    category: product.category,
    brand: product.brand,
    price,
    rating,
    numReviews: product.numReviews,
    stock: product.stock,
    isFeatured: product.isFeatured,
    images: product.images,
    ...hardAttrs,
  };
  if (existingSpecs) {
    productMetadata.specs = existingSpecs;
  }

  // Use ProductMetadata as doc metadata and base chunk metadata
  await indexDocument({
    productId,
    docType: 'product_detail',
    title: `${product.name} — 商品详情`,
    content,
    metadata: productMetadata as unknown as Record<string, unknown>,
    baseChunkMetadata: productMetadata as unknown as Record<string, unknown>,
  });
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

  let skipped = 0;
  const errors: string[] = [];

  for (const p of products) {
    try {
      await indexProductDetail(p.id);
    } catch (err: any) {
      errors.push(`${p.id}: ${err.message}`);
    }
  }

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
    // 先读取旧 metadata.specs，再清除旧数据，避免 specs 丢失
    let cachedSpecs: Record<string, unknown> | undefined;
    const oldDoc = await prisma.knowledgeDocument.findFirst({
      where: { productId, docType: 'product_detail' },
      orderBy: { version: 'desc' },
      select: { metadata: true },
    });
    if (oldDoc?.metadata && typeof oldDoc.metadata === 'object') {
      const meta = oldDoc.metadata as Record<string, unknown>;
      if (meta.specs && typeof meta.specs === 'object') {
        cachedSpecs = meta.specs as Record<string, unknown>;
      }
    }

    // 清除旧数据
    const oldDocs = await prisma.knowledgeDocument.findMany({
      where: { productId },
      select: { id: true },
    });
    for (const od of oldDocs) {
      await prisma.knowledgeChunk.deleteMany({ where: { documentId: od.id } });
      await prisma.knowledgeDocument.delete({ where: { id: od.id } });
    }

    // 重建（传入缓存 specs）
    await indexProductDetail(productId, cachedSpecs);
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
  filter: Record<string, unknown>,
  keepDocId: string,
): Promise<void> {
  const oldDocs = await prisma.knowledgeDocument.findMany({
    where: { ...filter, id: { not: keepDocId } } as any,
    select: { id: true },
  });
  for (const od of oldDocs) {
    await prisma.knowledgeChunk.deleteMany({ where: { documentId: od.id } });
    await prisma.knowledgeDocument.delete({ where: { id: od.id } });
  }
}
