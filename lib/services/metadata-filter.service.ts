import { prisma } from '@/lib/rag/db';
import { RetrievalHit } from '@/lib/services/rrf.service';

/** Parsed filter conditions extracted from a user query */
export interface MetadataFilter {
  priceMin?: number;
  priceMax?: number;
  ratingMin?: number;
  inStock?: boolean;
  category?: string;
  brand?: string;
  /** Hard attribute exact/in-list matches */
  attributes?: Record<string, string>;
}

/** Result of a metadata-filtered search */
export interface MetadataFilterResult {
  hits: RetrievalHit[];
  appliedFilters: string[];
}

const TOP_K_DEFAULT = 20;

// ── Query parsing ──

/**
 * Parse a user query into structured metadata filter conditions.
 * Only extracts conditions that map to precise, filterable fields.
 */
export function parseQueryFilters(query: string): MetadataFilter {
  const filter: MetadataFilter = {};
  const applied: string[] = [];

  // Price range: "100元以内", "50-100元", "不超过200", "500以下"
  const priceUnder = query.match(/(\d+)\s*元?\s*(?:以内|以下|不超过)/);
  const priceAbove = query.match(/(\d+)\s*元?\s*(?:以上|及以上|不低于)/);
  const priceRange = query.match(/(\d+)\s*[-到至]\s*(\d+)\s*元/);
  if (priceUnder) {
    filter.priceMax = Number(priceUnder[1]);
    applied.push(`priceMax=${filter.priceMax}`);
  }
  if (priceAbove) {
    filter.priceMin = Number(priceAbove[1]);
    applied.push(`priceMin=${filter.priceMin}`);
  }
  if (priceRange) {
    filter.priceMin = Number(priceRange[1]);
    filter.priceMax = Number(priceRange[2]);
    applied.push(`priceRange=${filter.priceMin}-${filter.priceMax}`);
  }

  // Rating: "评分4分以上", "4星以上"
  const ratingMatch = query.match(/评分?\s*(\d(?:\.\d)?)\s*(?:分|星)?\s*(?:以上|及以上)/);
  if (ratingMatch) {
    filter.ratingMin = Number(ratingMatch[1]);
    applied.push(`ratingMin=${filter.ratingMin}`);
  }

  // Stock: "有库存", "有货"
  if (/有库存|有货|现货/.test(query)) {
    filter.inStock = true;
    applied.push('inStock');
  }

  // Category (common e-commerce categories)
  const catMatch = query.match(/(衬衫|T恤|外套|裤子|裙|连衣裙|鞋子|卫衣|夹克|风衣|毛衣|POLO|短裤|羽绒服|棉服|西服|马甲)/);
  if (catMatch) {
    filter.category = catMatch[1];
    applied.push(`category=${filter.category}`);
  }

  // Brand
  const brandMatch = query.match(/品牌[是为:：]?\s*(\S{1,10})/);
  if (brandMatch) {
    filter.brand = brandMatch[1];
    applied.push(`brand=${filter.brand}`);
  }

  // Hard attributes from query
  filter.attributes = {};
  const attrPatterns: [string, RegExp][] = [
    ['material', /(纯棉|棉质|棉麻|真丝|羊毛|羊绒|真皮|牛仔|亚麻|莫代尔|涤纶|棉涤)/],
    ['fit', /(修身|宽松|常规|oversize|slim\s*fit|直筒|阔腿)/i],
    ['collar', /(圆领|V领|尖领|连帽|立领|翻领|POLO领|高领|纽扣领)/],
    ['sleeveLength', /(长袖|短袖|无袖|七分袖)/],
    ['thickness', /(加厚|厚实|薄款|适中厚度)/],
    ['stretch', /(弹性|微弹|高弹|无弹性)/],
    ['breathability', /(透气|透气性)/],
    ['season', /(春秋|夏季|秋冬|冬季|四季)/],
    ['scene', /(上班|通勤|商务|休闲|运动|户外|约会|居家|聚会)/],
  ];

  for (const [key, re] of attrPatterns) {
    const m = query.match(re);
    if (m) {
      filter.attributes[key] = m[1];
      applied.push(`${key}=${m[1]}`);
    }
  }

  if (Object.keys(filter.attributes).length === 0) {
    delete filter.attributes;
  }

  return filter;
}

// ── Attribute key whitelist ──

/**
 * Only these keys are allowed in generated SQL JSONB field access.
 * Any key not in this set is silently ignored to prevent injection via
 * attacker-controlled attribute names.
 */
const ALLOWED_ATTRIBUTE_KEYS = new Set([
  'material',
  'fit',
  'collar',
  'sleeveLength',
  'thickness',
  'stretch',
  'breathability',
  'season',
  'scene',
  'sizeAdvice',
]);

/** Returns the key if allowed, or undefined for unknown keys. */
export function safeAttributeKey(key: string): string | undefined {
  return ALLOWED_ATTRIBUTE_KEYS.has(key) ? key : undefined;
}

// ── SQL condition generation ──

/**
 * Generate safe parameterized SQL WHERE clauses from MetadataFilter.
 * All values use parameterized queries ($1, $2, ...) to prevent injection.
 * Attribute keys are validated against ALLOWED_ATTRIBUTE_KEYS — unknown keys
 * are silently dropped from the generated SQL.
 */
export function buildMetadataConditions(
  filter: MetadataFilter,
): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 0;

  const p = () => { paramIdx++; return `$${paramIdx}`; };

  if (filter.priceMin != null) {
    clauses.push(`(kc.metadata->>'price')::numeric >= ${p()}`);
    params.push(filter.priceMin);
  }
  if (filter.priceMax != null) {
    clauses.push(`(kc.metadata->>'price')::numeric <= ${p()}`);
    params.push(filter.priceMax);
  }
  if (filter.ratingMin != null) {
    clauses.push(`(kc.metadata->>'rating')::numeric >= ${p()}`);
    params.push(filter.ratingMin);
  }
  if (filter.inStock) {
    clauses.push(`(kc.metadata->>'stock')::int > 0`);
  }
  if (filter.category) {
    clauses.push(`kc.metadata->>'category' ILIKE ${p()}`);
    params.push(`%${filter.category}%`);
  }
  if (filter.brand) {
    clauses.push(`kc.metadata->>'brand' ILIKE ${p()}`);
    params.push(`%${filter.brand}%`);
  }
  if (filter.attributes) {
    for (const [key, value] of Object.entries(filter.attributes)) {
      const safeKey = safeAttributeKey(key);
      if (!safeKey) continue;
      clauses.push(`kc.metadata->>'${safeKey}' = ${p()}`);
      params.push(value);
    }
  }

  return { clauses, params };
}

// ── Metadata-only search ──

/**
 * Execute a metadata-only search (no FTS/vector), returning chunks sorted
 * by rating descending, then price ascending.
 */
export async function metadataSearch(
  filter: MetadataFilter,
  limit: number = TOP_K_DEFAULT,
): Promise<MetadataFilterResult> {
  const { clauses, params } = buildMetadataConditions(filter);

  if (clauses.length === 0) {
    return { hits: [], appliedFilters: [] };
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

    const appliedFilters = Object.entries(filter)
      .filter(([, v]) => v != null && (typeof v !== 'object' || Object.keys(v).length > 0))
      .map(([k]) => k);

    return {
      hits: (rows as any[]).map((r, i) => ({
        id: r.id,
        score: 1 - i * 0.05,
        source: 'metadata' as const,
        content: r.content,
        metadata: r.metadata,
      })),
      appliedFilters,
    };
  } catch (err) {
    console.error('[metadataSearch] Query failed:', err);
    return { hits: [], appliedFilters: [] };
  }
}

/**
 * Execute metadata-filtered FTS search.
 */
export async function metadataFilteredFTS(
  query: string,
  filter: MetadataFilter,
  limit: number = TOP_K_DEFAULT,
): Promise<MetadataFilterResult> {
  const tsquery = query.split(/\s+/).filter(Boolean).map(w => `${w}:*`).join(' & ');
  if (!tsquery) return metadataSearch(filter, limit);

  const { clauses, params } = buildMetadataConditions(filter);
  const allParams = [tsquery, ...params];
  const metaWhere = clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '';

  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT kc.id, kc.content, kc.metadata,
              ts_rank(kc.tsvector, to_tsquery('simple', $1)) AS rank
       FROM active_knowledge_chunk_view kc
       WHERE kc.tsvector @@ to_tsquery('simple', $1)
         AND kc."docType" = 'product_detail'
         ${metaWhere}
       ORDER BY rank DESC
       LIMIT ${limit}`,
      ...allParams,
    );

    return {
      hits: (rows as any[]).map(r => ({
        id: r.id,
        score: Number(r.rank),
        source: 'fts' as const,
        content: r.content,
        metadata: r.metadata,
      })),
      appliedFilters: Object.keys(filter).filter(k => {
        const v = (filter as any)[k];
        return v != null && (typeof v !== 'object' || Object.keys(v).length > 0);
      }),
    };
  } catch (err) {
    console.error('[metadataFilteredFTS] Query failed:', err);
    return { hits: [], appliedFilters: [] };
  }
}
