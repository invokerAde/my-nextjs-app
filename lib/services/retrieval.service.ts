import { prisma } from '@/lib/rag/db';
import { classifyIntent, IntentType } from '@/lib/services/intent.service';
import { reciprocalRankFusion, RetrievalHit } from '@/lib/services/rrf.service';
import { expandQuery } from '@/lib/rag/synonyms';
import { isEmbeddingConfigured } from '@/lib/services/embedding.service';
import { textToMetadataFilter } from '@/lib/services/text-to-metadata-filter.service';
import { translateAst } from '@/lib/services/filter-translator.service';
import { deriveFallbackAst } from '@/lib/rag/filter-ast';
import type { FilterAst } from '@/lib/rag/filter-ast';

export interface RetrievalResult {
  hits: RetrievalHit[];
  usedSources: ('fts' | 'vector' | 'metadata')[];
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

const TOP_K = 20;

const STRUCTURED_INTENTS: IntentType[] = ['product_filter', 'realtime_price_stock'];
const SEMANTIC_INTENTS: IntentType[] = ['product_detail', 'review_insight', 'policy_faq'];

export async function retrieve(
  query: string,
  context?: { productId?: string },
): Promise<RetrievalResult> {
  const intent = classifyIntent(query);

  // ── 1. LLM parse → AST + semanticQuery ──
  const parseResult = await textToMetadataFilter(query);
  const { semanticQuery, filterAst, warnings, usedTotalFallback } = parseResult;
  const expandedQuery = expandQuery(semanticQuery);

  const hasStructured = intent.intents.some(i => STRUCTURED_INTENTS.includes(i));
  const hasSemantic = intent.intents.some(i => SEMANTIC_INTENTS.includes(i));
  const isHybrid = intent.intents.includes('hybrid');

  const useMetadataFilter = isHybrid || (hasStructured && hasSemantic) || intent.intents.length >= 3 || (hasStructured && !hasSemantic);

  if (useMetadataFilter && filterAst && !usedTotalFallback) {
    // ── Attempt 1: full AST filter ──
    const result = await executeRetrieval(expandedQuery, context, filterAst);
    result.warnings = warnings;

    // ── Attempt 2: fallback AST if 0 hits ──
    if (result.hits.length === 0) {
      const fallbackAst = deriveFallbackAst(filterAst);
      if (fallbackAst) {
        console.warn('[retrieve] Full filter 0 hits, retrying with fallback AST');
        const fallbackResult = await executeRetrieval(expandedQuery, context, fallbackAst);
        if (fallbackResult.hits.length > 0) {
          fallbackResult.warnings = [...warnings, 'Used fallback filter (soft conditions dropped)'];
          return fallbackResult;
        }
        console.warn('[retrieve] Fallback filter also 0 hits, retrying unfiltered');
      } else {
        console.warn('[retrieve] Full filter 0 hits, no fallback AST');
      }
      const unfiltered = await retrieveByFTSVector(expandedQuery, context);
      unfiltered.warnings = [...warnings, 'All filters exhausted — unfiltered search'];
      return unfiltered;
    }
    return result;
  }

  if (hasSemantic && !hasStructured) {
    const result = await retrieveByFTSVector(expandedQuery, context);
    result.warnings = warnings;
    return result;
  }

  // Fallback: unfiltered
  const result = await retrieveByFTSVector(expandedQuery, context);
  result.warnings = usedTotalFallback
    ? [...warnings, 'Metadata parser failed — unfiltered search']
    : warnings;
  return result;
}

// ── Core execution ──

async function executeRetrieval(
  expandedQuery: string,
  context: { productId?: string } | undefined,
  filterAst: NonNullable<FilterAst>,
): Promise<RetrievalResult> {
  const usedSources: ('fts' | 'vector' | 'metadata')[] = [];
  const tasks: Promise<RetrievalHit[]>[] = [];

  // FTS: $1 = tsquery, translator starts at $2
  usedSources.push('fts');
  tasks.push(ftsSearch(expandedQuery, TOP_K, filterAst));

  // Vector: $1 = vector, translator starts at $2 (+ $3 if productId)
  if (isEmbeddingConfigured()) {
    usedSources.push('vector');
    tasks.push(vectorSearch(expandedQuery, context?.productId, TOP_K, filterAst));
  }

  usedSources.push('metadata');

  const hitGroups = await Promise.all(tasks);
  const hits = reciprocalRankFusion(hitGroups);
  return { hits, usedSources, confidence: computeConfidence(hits), warnings: [] };
}

// ── Search primitives ──

async function ftsSearch(
  query: string,
  limit: number,
  filterAst?: FilterAst,
): Promise<RetrievalHit[]> {
  const tsquery = query.split(/\s+/).filter(Boolean).map(w => `${w}:*`).join(' & ');
  if (!tsquery) return [];

  try {
    const params: any[] = [tsquery];
    let filterClause = '';

    if (filterAst) {
      const translation = translateAst(filterAst, 1); // offset=1: $1 is tsquery
      if (translation.clause !== 'TRUE') {
        filterClause = ` AND ${translation.clause}`;
        params.push(...translation.params);
      }
    }

    params.push(limit);

    const rows = await prisma.$queryRawUnsafe(
      `SELECT kc.id, kc.content, kc.metadata,
              ts_rank(kc.tsvector, to_tsquery('simple', $1)) AS rank
       FROM active_knowledge_chunk_view kc
       WHERE kc.tsvector @@ to_tsquery('simple', $1)${filterClause}
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
  filterAst?: FilterAst,
): Promise<RetrievalHit[]> {
  if (!isEmbeddingConfigured()) return [];

  try {
    const { generateEmbedding } = await import('@/lib/services/embedding.service');
    const embedding = await generateEmbedding(query);
    const vectorLiteral = `[${embedding.join(',')}]`;

    const params: any[] = [vectorLiteral];
    const extraParts: string[] = [];
    let paramOffset = 1; // $1 is vector

    if (productId) {
      extraParts.push(`kc."productId" = $${paramOffset + 1}`);
      params.push(productId);
      paramOffset++;
    }

    if (filterAst) {
      const translation = translateAst(filterAst, paramOffset);
      if (translation.clause !== 'TRUE') {
        extraParts.push(translation.clause);
        params.push(...translation.params);
      }
    }

    const whereClause = extraParts.length > 0
      ? `AND ${extraParts.join(' AND ')}`
      : '';

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

// ── Pure semantic fallback ──

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
  return {
    hits,
    usedSources: usedSources as ('fts' | 'vector' | 'metadata')[],
    confidence: computeConfidence(hits),
    warnings: [],
  };
}

// ── Confidence ──

function computeConfidence(hits: RetrievalHit[]): 'high' | 'medium' | 'low' {
  if (hits.length === 0) return 'low';
  if (hits.length >= 3) return 'high';
  return 'medium';
}
