'use server';

import { prisma } from '@/db/prisma';
import { chunkDocument } from '@/lib/rag/chunker';
import { computeDocHash } from '@/lib/rag/hasher';

export interface IndexDocumentParams {
  productId: string;
  docType: string;
  title: string;
  content: string;
  sourceRef?: string;
}

export async function indexDocument(params: IndexDocumentParams): Promise<{
  action: 'created' | 'updated' | 'skipped';
  docId: string;
}> {
  const docHash = computeDocHash(params.content);

  // Check if unchanged doc already exists with active chunks
  const existing = await prisma.knowledgeDocument.findFirst({
    where: { productId: params.productId, docType: params.docType, docHash },
    include: { chunks: { where: { isActive: true }, take: 1 } },
  });

  if (existing && existing.chunks.length > 0) {
    return { action: 'skipped', docId: existing.id };
  }

  // Deactivate old versions
  await prisma.knowledgeChunk.updateMany({
    where: {
      document: { productId: params.productId, docType: params.docType },
      isActive: true,
    },
    data: { isActive: false },
  });

  // Calculate version number
  const maxVersion = await prisma.knowledgeDocument.aggregate({
    _max: { version: true },
    where: { productId: params.productId, docType: params.docType },
  });
  const version = (maxVersion._max.version ?? 0) + 1;

  // Create document
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

  // Chunk and create chunks (embedding + tsvector populated later by async job)
  const chunks = chunkDocument(params.content);
  for (const c of chunks) {
    await prisma.knowledgeChunk.create({
      data: {
        documentId: doc.id,
        chunkIndex: c.index,
        content: c.content,
        tokenCount: c.tokenCount,
        isActive: true,
        version,
      },
    });
  }

  // Async cleanup old versions
  deleteOldVersions(params.productId, params.docType, doc.id).catch(err =>
    console.error('Old version cleanup failed:', err),
  );

  return { action: existing ? 'updated' : 'created', docId: doc.id };
}

export async function indexProductDetail(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { Review: { select: { description: true, title: true, rating: true } } },
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
