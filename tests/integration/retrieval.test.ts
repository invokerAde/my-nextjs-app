import { classifyIntent } from '@/lib/services/intent.service';
import { reciprocalRankFusion, RetrievalHit } from '@/lib/services/rrf.service';
import { parseQueryFilters, buildMetadataConditions, safeAttributeKey } from '@/lib/services/metadata-filter.service';
import { extractFromSpec, extractFromText, extractAttributes } from '@/lib/services/attribute-extractor.service';

describe('Retrieval pipeline integration', () => {
  it('intent → RRF works for filter query', () => {
    const intent = classifyIntent('100元以内棉质长袖衬衫有什么推荐？');
    expect(intent.intents).toContain('product_filter');

    const ftsHits: RetrievalHit[] = [
      { id: 'c1', score: 0.8, source: 'fts', content: '棉质长袖衬衫...' },
    ];
    const vecHits: RetrievalHit[] = [
      { id: 'c1', score: 0.85, source: 'vector', content: '棉质长袖衬衫...' },
      { id: 'c2', score: 0.7, source: 'vector', content: '纯棉衬衫...' },
    ];
    const metaHits: RetrievalHit[] = [
      { id: 'c1', score: 0.9, source: 'metadata', content: '棉质长袖衬衫...' },
    ];
    const merged = reciprocalRankFusion([ftsHits, vecHits, metaHits]);
    expect(merged.length).toBeGreaterThanOrEqual(1);
    expect(merged.filter(r => r.id === 'c1')).toHaveLength(1);
  });

  it('all realtime queries are time-sensitive', () => {
    const queries = ['这件衣服多少钱？', '这款还有M码吗？', '现在有什么优惠？'];
    for (const q of queries) {
      expect(classifyIntent(q).intents).toContain('realtime_price_stock');
    }
  });

  it('RRF deduplicates across sources including metadata', () => {
    const fts: RetrievalHit[] = [{ id: 'A', score: 10, source: 'fts' }];
    const vec: RetrievalHit[] = [{ id: 'A', score: 0.9, source: 'vector' }, { id: 'B', score: 0.5, source: 'vector' }];
    const meta: RetrievalHit[] = [{ id: 'A', score: 0.7, source: 'metadata' }];
    const result = reciprocalRankFusion([fts, vec, meta]);
    expect(result.filter(r => r.id === 'A')).toHaveLength(1);
    expect(result.some(r => r.source === 'fts' || r.source === 'vector' || r.source === 'metadata')).toBe(true);
  });
});

describe('parseQueryFilters', () => {
  it('parses price range: 100元以内', () => {
    const f = parseQueryFilters('100元以内棉质长袖衬衫');
    expect(f.priceMax).toBe(100);
  });

  it('parses price range: 50-100', () => {
    const f = parseQueryFilters('50-100元的衬衫');
    expect(f.priceMin).toBe(50);
    expect(f.priceMax).toBe(100);
  });

  it('parses rating filter', () => {
    const f = parseQueryFilters('评分4分以上透气连衣裙');
    expect(f.ratingMin).toBe(4);
  });

  it('parses in-stock filter', () => {
    const f = parseQueryFilters('有库存的黑色修身外套');
    expect(f.inStock).toBe(true);
  });

  it('parses category from query', () => {
    const f = parseQueryFilters('有什么好看的衬衫推荐');
    expect(f.category).toBe('衬衫');
  });

  it('parses material attribute', () => {
    const f = parseQueryFilters('纯棉长袖衬衫');
    expect(f.attributes?.material).toBe('纯棉');
  });

  it('parses fit attribute', () => {
    const f = parseQueryFilters('修身版型外套');
    expect(f.attributes?.fit).toBe('修身');
  });

  it('parses multiple attributes', () => {
    const f = parseQueryFilters('纯棉修身长袖衬衫');
    expect(f.attributes?.material).toBe('纯棉');
    expect(f.attributes?.fit).toBe('修身');
    expect(f.attributes?.sleeveLength).toBe('长袖');
  });

  it('returns empty filter for non-product queries', () => {
    const f = parseQueryFilters('你好');
    expect(f.priceMin).toBeUndefined();
    expect(f.priceMax).toBeUndefined();
    expect(f.ratingMin).toBeUndefined();
    expect(f.inStock).toBeUndefined();
    expect(f.category).toBeUndefined();
  });
});

describe('extractAttributes', () => {
  const sampleSpecs = {
    material: '纯棉',
    fit: '修身',
    collar: '尖领',
    sleeve_length: '长袖',
    thickness: '适中',
    stretch: '微弹',
    breathability: '良好',
    occasion: '商务通勤',
    season: '春秋',
    size_advice: '建议按正常尺码购买',
  };

  it('extracts from spec JSON', () => {
    const attrs = extractFromSpec(sampleSpecs);
    expect(attrs.material).toBe('纯棉');
    expect(attrs.fit).toBe('修身');
    expect(attrs.collar).toBe('尖领');
    expect(attrs.sleeveLength).toBe('长袖');
    expect(attrs.scene).toBe('商务通勤');
  });

  it('extracts from text content', () => {
    const text = '纯棉面料，修身版型，长袖设计，适合商务通勤穿着';
    const attrs = extractFromText(text);
    expect(attrs.material).toBe('纯棉');
    expect(attrs.fit).toBe('修身');
    expect(attrs.sleeveLength).toBe('长袖');
    expect(attrs.scene).toBe('商务通勤');
  });

  it('spec values take priority over text', () => {
    const text = '宽松版型纯棉衬衫';
    const attrs = extractAttributes(text, sampleSpecs);
    // spec fit is 修身, should override text's 宽松
    expect(attrs.fit).toBe('修身');
    // material is in both, spec wins
    expect(attrs.material).toBe('纯棉');
  });

  it('fills gaps from text when spec is missing', () => {
    const partialSpecs = { material: '纯棉' };
    const text = '纯棉面料，修身版型，尖领设计';
    const attrs = extractAttributes(text, partialSpecs);
    expect(attrs.material).toBe('纯棉');
    expect(attrs.fit).toBe('修身');
    expect(attrs.collar).toBe('尖领');
  });
});

describe('safeAttributeKey', () => {
  it('allows known attribute keys', () => {
    expect(safeAttributeKey('material')).toBe('material');
    expect(safeAttributeKey('fit')).toBe('fit');
    expect(safeAttributeKey('collar')).toBe('collar');
    expect(safeAttributeKey('sleeveLength')).toBe('sleeveLength');
    expect(safeAttributeKey('thickness')).toBe('thickness');
    expect(safeAttributeKey('stretch')).toBe('stretch');
    expect(safeAttributeKey('breathability')).toBe('breathability');
    expect(safeAttributeKey('season')).toBe('season');
    expect(safeAttributeKey('scene')).toBe('scene');
    expect(safeAttributeKey('sizeAdvice')).toBe('sizeAdvice');
  });

  it('rejects unknown attribute keys', () => {
    expect(safeAttributeKey('')).toBeUndefined();
    expect(safeAttributeKey('unknown')).toBeUndefined();
    expect(safeAttributeKey('DROP TABLE')).toBeUndefined();
    expect(safeAttributeKey('price')).toBeUndefined();
    expect(safeAttributeKey("1; DROP TABLE")).toBeUndefined();
    expect(safeAttributeKey('category')).toBeUndefined();
  });
});

describe('buildMetadataConditions whitelist', () => {
  it('generates clauses for legal attribute keys', () => {
    const { clauses, params } = buildMetadataConditions({
      attributes: { material: '纯棉', fit: '修身' },
    });
    expect(clauses).toHaveLength(2);
    expect(clauses[0]).toContain("->>'material'");
    expect(clauses[1]).toContain("->>'fit'");
    expect(params).toEqual(['纯棉', '修身']);
  });

  it('silently drops illegal attribute keys', () => {
    const { clauses, params } = buildMetadataConditions({
      attributes: { material: '纯棉', injected: 'evil', '; DROP--': 'x' },
    });
    // Only 'material' is legal
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toContain("->>'material'");
    expect(params).toEqual(['纯棉']);
  });

  it('returns empty when all attributes are illegal', () => {
    const { clauses, params } = buildMetadataConditions({
      attributes: { hack: 'x', unknown: 'y' },
    });
    expect(clauses).toHaveLength(0);
    expect(params).toHaveLength(0);
  });

  it('values still go through parameterized binding', () => {
    const { clauses, params } = buildMetadataConditions({
      attributes: { material: "'; DROP TABLE Users;--" },
    });
    expect(clauses).toHaveLength(1);
    // The value is a parameter, not inlined in SQL
    expect(clauses[0]).not.toContain('DROP');
    expect(params[0]).toBe("'; DROP TABLE Users;--");
  });
});
