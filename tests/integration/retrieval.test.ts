import { classifyIntent } from '@/lib/services/intent.service';
import { reciprocalRankFusion, RetrievalHit } from '@/lib/services/rrf.service';
import { validateAst, deriveFallbackAst, collectConditions } from '@/lib/rag/filter-ast';
import { translateAst } from '@/lib/services/filter-translator.service';
import { getFieldSchema, getAllFieldNames } from '@/lib/rag/metadata-schema';
import { safeAttributeKey } from '@/lib/services/metadata-filter.service';
import { extractFromSpec, extractFromText, extractAttributes } from '@/lib/services/attribute-extractor.service';
import type { FilterAst } from '@/lib/rag/filter-ast';

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

// ── AST validation pipeline tests ──

describe('Filter AST + translate → SQL pipeline', () => {
  it('price filter AST validates and translates with safe numeric cast', () => {
    const ast: FilterAst = { field: 'price', op: 'lte', value: 100 };
    const v = validateAst(ast);
    expect(v.valid).toBe(true);

    const t = translateAst(ast);
    expect(t.clause).toContain('CASE');
    expect(t.clause).toContain('::numeric');
    expect(t.params).toEqual([100]);
  });

  it('material + sleeveLength and AST', () => {
    const ast: FilterAst = {
      type: 'and',
      children: [
        { field: 'price', op: 'lte', value: 100 },
        { field: 'material', op: 'eq', value: '纯棉' },
        { field: 'sleeveLength', op: 'eq', value: '长袖' },
      ],
    };
    const v = validateAst(ast);
    expect(v.valid).toBe(true);

    const t = translateAst(ast);
    expect(t.clause).toContain(' AND ');
    expect(t.params).toEqual([100, '纯棉', '长袖']);
  });

  it('unknown field rejected by AST validation', () => {
    const ast: FilterAst = { field: 'nonexistent', op: 'eq', value: 'x' };
    const v = validateAst(ast);
    expect(v.valid).toBe(false);
  });

  it('string[] in uses independent params', () => {
    const ast: FilterAst = { field: 'season', op: 'in', value: ['春秋', '夏季'] };
    const v = validateAst(ast);
    expect(v.valid).toBe(true);

    const t = translateAst(ast);
    // 2 values × 2 params each = 4 params
    expect(t.params).toHaveLength(4);
  });

  it('paramOffset shifts $N references', () => {
    const ast: FilterAst = { field: 'material', op: 'eq', value: '纯棉' };

    const t0 = translateAst(ast, 0);
    expect(t0.clause).toContain('$1');

    const t1 = translateAst(ast, 1);
    expect(t1.clause).toContain('$2'); // offset=1 → $1 becomes $2
    expect(t1.params).toEqual(['纯棉']);
  });
});

// ── Fallback AST tests ──

describe('Fallback AST (2-attempt retrieval)', () => {
  it('deriveFallbackAst preserves hard category filter', () => {
    const ast: FilterAst = {
      type: 'and',
      children: [
        { field: 'category', op: 'contains', value: '衬衫' },
        { field: 'price', op: 'lte', value: 100 },
        { field: 'material', op: 'eq', value: '纯棉' },
      ],
    };
    const fallback = deriveFallbackAst(ast);
    const conds = collectConditions(fallback!);
    const fields = conds.map(c => c.field);
    expect(fields).toContain('category');
  });

  it('fallback drops soft conditions when hard exist', () => {
    const ast: FilterAst = {
      type: 'and',
      children: [
        { field: 'category', op: 'contains', value: '衬衫' },
        { field: 'price', op: 'lte', value: 100 },
      ],
    };
    const fallback = deriveFallbackAst(ast);
    const conds = collectConditions(fallback!);
    expect(conds).toHaveLength(1);
    expect(conds[0].field).toBe('category');
  });

  it('null AST → null fallback', () => {
    expect(deriveFallbackAst(null)).toBeNull();
  });
});

// ── Attribute extraction ──

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
    expect(attrs.fit).toBe('修身');
    expect(attrs.material).toBe('纯棉');
  });
});

// ── Schema registry ──

describe('Schema registry', () => {
  it('getAllFieldNames includes all expected fields', () => {
    const names = getAllFieldNames();
    expect(names).toContain('price');
    expect(names).toContain('category');
    expect(names).toContain('material');
    expect(names).toContain('season');
    expect(names).toContain('scene');
  });

  it('safeAttributeKey delegates to schema registry', () => {
    expect(safeAttributeKey('material')).toBe('material');
    expect(safeAttributeKey('unknown')).toBeUndefined();
    expect(safeAttributeKey('')).toBeUndefined();
  });

  it('getFieldSchema returns correct type', () => {
    expect(getFieldSchema('price')?.type).toBe('number');
    expect(getFieldSchema('category')?.filterStrength).toBe('hard');
    expect(getFieldSchema('season')?.type).toBe('string[]');
  });
});
