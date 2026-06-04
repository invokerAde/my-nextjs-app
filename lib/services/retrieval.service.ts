import { prisma } from '@/lib/rag/db';
import { classifyIntent, IntentResult, IntentType } from '@/lib/services/intent.service';
import { reciprocalRankFusion, RetrievalHit } from '@/lib/services/rrf.service';
import { expandQuery } from '@/lib/rag/synonyms';
import { isEmbeddingConfigured } from '@/lib/services/embedding.service';
import {
  MetadataFilter,
  parseQueryFilters,
  buildMetadataConditions,
} from '@/lib/services/metadata-filter.service';

export interface RetrievalResult {
  hits: RetrievalHit[];
  usedSources: ('fts' | 'vector' | 'metadata')[];
  confidence: 'high' | 'medium' | 'low';
}

const TOP_K = 20;

const STRUCTURED_INTENTS: IntentType[] = ['product_filter', 'realtime_price_stock'];
const SEMANTIC_INTENTS: IntentType[] = ['product_detail', 'review_insight', 'policy_faq'];

export async function retrieve(
  query: string,
  context?: { productId?: string },
): Promise<RetrievalResult> {
  const intent = classifyIntent(query);
  const expandedQuery = expandQuery(query);

  const hasStructured = intent.intents.some(i => STRUCTURED_INTENTS.includes(i));
  const hasSemantic = intent.intents.some(i => SEMANTIC_INTENTS.includes(i));
  const isHybrid = intent.intents.includes('hybrid');

  // 混合场景: 多意图或默认 hybrid → metadata filter + FTS + vector 并行召回
  if (isHybrid || (hasStructured && hasSemantic) || intent.intents.length >= 3) {
    return retrieveByAll(query, expandedQuery, context);
  }

  // 纯结构化: metadata filter + vector
  if (hasStructured && !hasSemantic) {
    return retrieveByMetadataAndVector(query, expandedQuery, context);
  }

  // 纯语义: FTS + vector
  if (hasSemantic && !hasStructured) {
    return retrieveByFTSVector(expandedQuery, context);
  }

  // 兜底
  return retrieveByAll(query, expandedQuery, context);
}

// ── Search primitives ──

async function ftsSearch(
  query: string,
  limit: number,
  filter?: MetadataFilter,
): Promise<RetrievalHit[]> {
  const tsquery = query.split(/\s+/).filter(Boolean).map(w => `${w}:*`).join(' & ');
  if (!tsquery) return [];

  try {
    let whereClause = `kc.tsvector @@ to_tsquery('simple', $1)`;
    const params: any[] = [tsquery];

    if (filter) {
      const { clauses, params: filterParams } = buildMetadataConditions(filter);
      if (clauses.length > 0) {
        whereClause += ` AND ${clauses.join(' AND ')}`;
        params.push(...filterParams);
      }
    }

    params.push(limit);

    const rows = await prisma.$queryRawUnsafe(
      `SELECT kc.id, kc.content, kc.metadata,
              ts_rank(kc.tsvector, to_tsquery('simple', $1)) AS rank
       FROM active_knowledge_chunk_view kc
       WHERE ${whereClause}
       ORDER BY rank DESC LIMIT $${params.length}`,
      ...params,
    );
    return (rows as any[]).map(r => ({
      id: r.id, score: Number(r.rank), source: 'fts' as const,
      content: r.content, metadata: r.metadata,
    }));
  } catch (err) {
    console.error('[ftsSearch] FTS query failed:', err);
    return [];
  }
}

async function vectorSearch(
  query: string,
  productId?: string,
  limit: number = TOP_K,
  filter?: MetadataFilter,
): Promise<RetrievalHit[]> {
  if (!isEmbeddingConfigured()) return [];

  try {
    const { generateEmbedding } = await import('@/lib/services/embedding.service');
    const embedding = await generateEmbedding(query);
    const vectorLiteral = `[${embedding.join(',')}]`;

    const params: any[] = [vectorLiteral];
    let whereClause = '';

    if (productId) {
      whereClause += `AND kc."productId" = $${params.length + 1}`;
      params.push(productId);
    }

    if (filter) {
      const { clauses, params: filterParams } = buildMetadataConditions(filter);
      if (clauses.length > 0) {
        for (const clause of clauses) {
          // Replace $1, $2, ... with re-indexed params
          const reindexed = clause.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + params.length}`);
          whereClause += `AND ${reindexed} `;
        }
        params.push(...filterParams);
      }
    }

    params.push(limit);

    const rows = await prisma.$queryRawUnsafe(
      `SELECT kc.id, kc.content, kc.metadata,
              1 - (kc.embedding <=> $1::vector) AS distance
       FROM active_knowledge_chunk_view kc
       WHERE kc.embedding IS NOT NULL ${whereClause}
       ORDER BY kc.embedding <=> $1::vector LIMIT $${params.length}`,
      ...params,
    );
    return (rows as any[]).map(r => ({
      id: r.id, score: Number(r.distance), source: 'vector' as const,
      content: r.content, metadata: r.metadata,
    }));
  } catch (err) {
    console.error('[vectorSearch] Vector search failed:', err);
    return [];
  }
}

/**
 * Metadata-only search: parses query filters, filters by chunk metadata,
 * returns hits sorted by rating DESC.
 */
async function metadataOnlySearch(
  query: string,
  limit: number = TOP_K,
): Promise<{ hits: RetrievalHit[]; filter: MetadataFilter }> {
  const filter = parseQueryFilters(query);
  const { clauses, params } = buildMetadataConditions(filter);

  if (clauses.length === 0) {
    return { hits: [], filter };
  }

  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT kc.id, kc.content, kc.metadata,
              COALESCE((kc.metadata->>'rating')::numeric, 0) AS rating
       FROM active_knowledge_chunk_view kc
       WHERE ${clauses.join(' AND ')}
         AND kc."docType" = 'product_detail'
       ORDER BY rating DESC
       LIMIT ${limit}`,
      ...params,
    );

    return {
      filter,
      hits: (rows as any[]).map((r, i) => ({
        id: r.id,
        score: 1 - i * 0.05,
        source: 'metadata' as const,
        content: r.content,
        metadata: r.metadata,
      })),
    };
  } catch (err) {
    console.error('[metadataOnlySearch] Query failed:', err);
    return { hits: [], filter };
  }
}

// ── Confidence ──

function computeConfidence(hits: RetrievalHit[]): 'high' | 'medium' | 'low' {
  if (hits.length === 0) return 'low';
  if (hits.length >= 3) return 'high';
  return 'medium';
}

// ── Route functions ──

/** 结构化查询: metadata filter + vector, metadata filter 无结果时降级为 FTS+vector */
async function retrieveByMetadataAndVector(
  query: string,
  expandedQuery: string,
  context?: { productId?: string },
): Promise<RetrievalResult> {
  const filter = parseQueryFilters(query);
  const hasFilter = Object.keys(filter).length > 0;

  const usedSources: ('fts' | 'vector' | 'metadata')[] = [];
  const tasks: Promise<RetrievalHit[]>[] = [];

  // FTS with metadata pre-filter
  usedSources.push('fts');
  tasks.push(ftsSearch(expandedQuery, TOP_K, hasFilter ? filter : undefined));

  // Vector with metadata pre-filter
  if (isEmbeddingConfigured()) {
    usedSources.push('vector');
    tasks.push(vectorSearch(expandedQuery, context?.productId, TOP_K, hasFilter ? filter : undefined));
  }

  if (hasFilter) {
    usedSources.push('metadata');
  }

  const hitGroups = await Promise.all(tasks);
  const hits = reciprocalRankFusion(hitGroups);

  // Fallback: if metadata-filtered results are empty, try without filter
  if (hits.length === 0 && hasFilter) {
    console.warn('[retrieve] Metadata filter returned 0 results, falling back to FTS+vector');
    return retrieveByFTSVector(expandedQuery, context);
  }

  return { hits, usedSources, confidence: computeConfidence(hits) };
}

/** 详情/评论/FAQ: FTS + vector + RRF */
async function retrieveByFTSVector(
  expandedQuery: string,
  context?: { productId?: string },
): Promise<RetrievalResult> {
  const usedSources: ('fts' | 'vector')[] = ['fts'];
  const tasks: Promise<RetrievalHit[]>[] = [ftsSearch(expandedQuery, TOP_K)];

  if (isEmbeddingConfigured()) {
    usedSources.push('vector');
    tasks.push(vectorSearch(expandedQuery, context?.productId, TOP_K));
  }

  const hitGroups = await Promise.all(tasks);
  const hits = reciprocalRankFusion(hitGroups);
  return { hits, usedSources: usedSources as ('fts' | 'vector' | 'metadata')[], confidence: computeConfidence(hits) };
}

/** 混合: metadata 作为前置过滤 + FTS + vector 并行 + RRF */
async function retrieveByAll(
  query: string,
  expandedQuery: string,
  context?: { productId?: string },
): Promise<RetrievalResult> {
  const filter = parseQueryFilters(query);
  const hasFilter = Object.keys(filter).length > 0;

  const usedSources: ('fts' | 'vector' | 'metadata')[] = [];
  const tasks: Promise<RetrievalHit[]>[] = [];

  // FTS with metadata pre-filter
  usedSources.push('fts');
  tasks.push(ftsSearch(expandedQuery, TOP_K, hasFilter ? filter : undefined));

  // Vector with metadata pre-filter
  if (isEmbeddingConfigured()) {
    usedSources.push('vector');
    tasks.push(vectorSearch(expandedQuery, context?.productId, TOP_K, hasFilter ? filter : undefined));
  }

  if (hasFilter) {
    usedSources.push('metadata');
  }

  const hitGroups = await Promise.all(tasks);
  const hits = reciprocalRankFusion(hitGroups);

  // Fallback: if filtered results empty, retry without filter
  if (hits.length === 0 && hasFilter) {
    console.warn('[retrieve] Metadata filter returned 0 results, falling back to FTS+vector');
    return retrieveByFTSVector(expandedQuery, context);
  }

  return { hits, usedSources, confidence: computeConfidence(hits) };
}
