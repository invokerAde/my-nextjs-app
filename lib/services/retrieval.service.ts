import { prisma } from '@/db/prisma';
import { classifyIntent } from '@/lib/services/intent.service';
import { reciprocalRankFusion, RetrievalHit } from '@/lib/services/rrf.service';
import { expandQuery } from '@/lib/rag/synonyms';

export interface RetrievalResult {
  hits: RetrievalHit[];
  sqlResult?: Record<string, unknown>[];
  usedSources: ('fts' | 'vector' | 'sql')[];
  confidence: 'high' | 'medium' | 'low';
}

const TOP_K = 20;

export async function retrieve(
  query: string,
  context?: { productId?: string },
): Promise<RetrievalResult> {
  const intent = classifyIntent(query);
  const expandedQuery = expandQuery(query);

  const tasks: Promise<RetrievalHit[]>[] = [];
  const usedSources: ('fts' | 'vector' | 'sql')[] = [];

  // Route based on intent
  if (intent.intent === 'realtime_price_stock') {
    // Strong timeliness: FTS + vector only (Text2SQL will be added in Batch 5)
    usedSources.push('fts', 'vector');
    tasks.push(ftsSearch(expandedQuery, TOP_K));
    tasks.push(vectorSearch(expandedQuery, context?.productId, TOP_K));
  } else if (intent.intent === 'product_filter') {
    usedSources.push('fts', 'vector');
    tasks.push(ftsSearch(expandedQuery, TOP_K));
    tasks.push(vectorSearch(expandedQuery, context?.productId, TOP_K));
  } else {
    // product_detail, review_insight, policy_faq, hybrid: FTS + vector parallel
    usedSources.push('fts', 'vector');
    tasks.push(ftsSearch(expandedQuery, TOP_K));
    tasks.push(vectorSearch(expandedQuery, context?.productId, TOP_K));
  }

  const hitGroups = await Promise.all(tasks);
  const hits = reciprocalRankFusion(hitGroups);
  const confidence = computeConfidence(hits, undefined);

  return { hits, usedSources, confidence };
}

async function ftsSearch(query: string, limit: number): Promise<RetrievalHit[]> {
  const tsquery = query.split(/\s+/).filter(Boolean).map(w => `${w}:*`).join(' & ');
  if (!tsquery) return [];

  try {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: string; content: string; productId: string; docType: string; rank: number }>
    >(
      `SELECT kc.id, kc.content, kd."productId", kd."docType",
              ts_rank(kc.tsvector, to_tsquery('simple', $1)) AS rank
       FROM active_knowledge_chunk_view kc
       WHERE kc.tsvector @@ to_tsquery('simple', $1)
       ORDER BY rank DESC LIMIT $2`,
      tsquery,
      limit,
    );
    return rows.map(r => ({
      id: r.id, score: Number(r.rank), source: 'fts' as const,
      content: r.content, metadata: { productId: r.productId, docType: r.docType },
    }));
  } catch {
    return [];
  }
}

async function vectorSearch(
  query: string,
  productId?: string,
  limit: number = TOP_K,
): Promise<RetrievalHit[]> {
  try {
    const { generateEmbedding } = await import('@/lib/services/embedding.service');
    const embedding = await generateEmbedding(query);
    const vectorLiteral = `[${embedding.join(',')}]`;

    let whereClause = '';
    const params: any[] = [vectorLiteral, limit];
    if (productId) {
      whereClause = `AND kd."productId" = $3`;
      params.push(productId);
    }

    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: string; content: string; productId: string; docType: string; distance: number }>
    >(
      `SELECT kc.id, kc.content, kd."productId", kd."docType",
              1 - (kc.embedding <=> $1::vector) AS distance
       FROM active_knowledge_chunk_view kc
       WHERE kc.embedding IS NOT NULL ${whereClause}
       ORDER BY kc.embedding <=> $1::vector LIMIT $2`,
      ...params,
    );
    return rows.map(r => ({
      id: r.id, score: Number(r.distance), source: 'vector' as const,
      content: r.content, metadata: { productId: r.productId, docType: r.docType },
    }));
  } catch {
    return [];
  }
}

function computeConfidence(
  hits: RetrievalHit[],
  sqlResult?: Record<string, unknown>[],
): 'high' | 'medium' | 'low' {
  if (hits.length === 0 && (!sqlResult || sqlResult.length === 0)) return 'low';
  if (hits.length >= 3 || (sqlResult && sqlResult.length >= 2)) return 'high';
  return 'medium';
}
