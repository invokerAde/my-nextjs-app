'use server';

import { prisma } from '@/lib/rag/db';
import { cleanReviewText } from '@/lib/rag/cleaner';
import { indexDocument } from '@/lib/services/index.service';

const REVIEW_THRESHOLD = Number(process.env.REVIEW_DIRECT_CHUNK_THRESHOLD) || 5;

export interface IngestionResult {
  path: 'direct' | 'aggregate' | 'skipped';
  message: string;
}

export async function ingestProductReviews(productId: string): Promise<IngestionResult> {
  const reviewCount = await prisma.review.count({ where: { productId } });

  if (reviewCount === 0) {
    return { path: 'skipped', message: 'No reviews for product' };
  }

  if (reviewCount <= REVIEW_THRESHOLD) {
    return await ingestDirectReviews(productId);
  } else {
    return await ingestAggregatedReviews(productId);
  }
}

async function ingestDirectReviews(productId: string): Promise<IngestionResult> {
  const reviews = await prisma.review.findMany({
    where: { productId },
    select: { id: true, description: true, title: true, rating: true },
  });

  const cleanedTexts: string[] = [];
  for (const r of reviews) {
    const text = `${r.title || ''} ${r.description || ''}`;
    const cleaned = cleanReviewText(text);
    if (cleaned) cleanedTexts.push(`[评分${r.rating}] ${cleaned.join(' ')}`);
  }

  if (cleanedTexts.length === 0) {
    return { path: 'direct', message: 'No signal after cleaning' };
  }

  const content = cleanedTexts.join('\n\n');

  // Delete any old review_insight docs to switch path
  const oldDoc = await prisma.knowledgeDocument.findFirst({
    where: { productId, docType: 'review_insight' },
  });
  if (oldDoc) {
    await prisma.knowledgeChunk.deleteMany({ where: { documentId: oldDoc.id } });
    await prisma.knowledgeDocument.delete({ where: { id: oldDoc.id } });
  }

  await indexDocument({
    productId,
    docType: 'review_direct',
    title: `用户评论直入 - ${productId}`,
    content,
  });

  return { path: 'direct', message: `Ingested ${cleanedTexts.length} reviews as direct chunks` };
}

async function ingestAggregatedReviews(productId: string): Promise<IngestionResult> {
  const reviews = await prisma.review.findMany({
    where: { productId },
    select: { description: true, title: true, rating: true },
    orderBy: { createdAt: 'desc' },
  });

  const cleanedTexts: string[] = [];
  for (const r of reviews) {
    const text = `${r.title || ''} ${r.description || ''}`;
    const cleaned = cleanReviewText(text);
    if (cleaned) cleanedTexts.push(`[评分${r.rating}] ${cleaned.join(' ')}`);
  }

  if (cleanedTexts.length === 0) {
    return { path: 'aggregate', message: 'No signal after cleaning' };
  }

  const aggregatedContent = simpleAggregate(cleanedTexts, productId);

  const oldInsight = await prisma.reviewInsight.findFirst({
    where: { productId },
    orderBy: { version: 'desc' },
  });
  const version = (oldInsight?.version ?? 0) + 1;

  await prisma.reviewInsight.create({
    data: {
      productId,
      content: aggregatedContent,
      metadata: { reviewCount: reviews.length, cleanedCount: cleanedTexts.length },
      version,
    },
  });

  // Clean old review_direct and review_insight knowledge docs
  await prisma.knowledgeChunk.deleteMany({
    where: { document: { productId, docType: { in: ['review_direct', 'review_insight'] } } },
  });
  await prisma.knowledgeDocument.deleteMany({
    where: { productId, docType: { in: ['review_direct', 'review_insight'] } },
  });

  await indexDocument({
    productId,
    docType: 'review_insight',
    title: `评论聚合洞察 v${version} - ${productId}`,
    content: aggregatedContent,
  });

  // Keep only latest 2 insight versions
  const oldVersions = await prisma.reviewInsight.findMany({
    where: { productId },
    orderBy: { version: 'desc' },
    skip: 2,
  });
  for (const ov of oldVersions) {
    await prisma.reviewInsight.delete({ where: { id: ov.id } });
  }

  return { path: 'aggregate', message: `Aggregated ${cleanedTexts.length} reviews, v${version}` };
}

function simpleAggregate(cleanedTexts: string[], productId: string): string {
  const ratingPattern = /\[评分(\d)\]/;
  const ratings = cleanedTexts
    .map(t => { const m = t.match(ratingPattern); return m ? parseInt(m[1]) : null; })
    .filter(Boolean) as number[];

  const avgRating = ratings.length > 0
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
    : 'N/A';

  return [
    `商品 ${productId} 用户评论聚合 (${cleanedTexts.length} 条有效评论)`,
    `平均评分: ${avgRating}/5`,
    '',
    '用户反馈摘要:',
    ...cleanedTexts.slice(0, 30),
  ].join('\n');
}
