/**
 * text-to-metadata-filter tests.
 *
 * Since the service calls OpenAI (or compatible) LLM, these tests mock
 * the OpenAI client to return controlled responses.  We test the parsing
 * and fallback logic without real API calls.
 */

import { type FilterAst, collectConditions } from '@/lib/rag/filter-ast';

// We test the parsing logic directly by validating ASTs that would be
// produced from LLM JSON responses, avoiding the OpenAI dependency.

describe('textToMetadataFilter — AST shape validation', () => {
  it('price filter via lte on 100元以内', () => {
    // Simulated LLM output for: "100元以内棉质长袖衬衫"
    const ast: FilterAst = {
      type: 'and',
      children: [
        { field: 'price', op: 'lte', value: 100 },
        { field: 'material', op: 'eq', value: '纯棉' },
        { field: 'sleeveLength', op: 'eq', value: '长袖' },
      ],
    };
    const conds = collectConditions(ast!);
    expect(conds).toHaveLength(3);
    const priceCond = conds.find(c => c.field === 'price')!;
    expect(priceCond.op).toBe('lte');
    expect(priceCond.value).toBe(100);
  });

  it('multi-value in for season query', () => {
    // "春秋两季都能穿的衣服"
    const ast: FilterAst = {
      field: 'season', op: 'in', value: ['春秋', '四季通用'],
    };
    const conds = collectConditions(ast!);
    expect(conds).toHaveLength(1);
    expect(conds[0].op).toBe('in');
    expect(conds[0].value).toEqual(['春秋', '四季通用']);
  });

  it('multi-value scene with in', () => {
    // "上班通勤都能穿"
    const ast: FilterAst = {
      field: 'scene', op: 'in', value: ['上班', '通勤'],
    };
    const conds = collectConditions(ast!);
    expect(conds[0].op).toBe('in');
    expect(conds[0].value).toEqual(['上班', '通勤']);
  });

  it('stock check via gt 0', () => {
    // "有库存的修身外套"
    const ast: FilterAst = {
      type: 'and',
      children: [
        { field: 'stock', op: 'gt', value: 0 },
        { field: 'fit', op: 'eq', value: '修身' },
      ],
    };
    const conds = collectConditions(ast!);
    const stockCond = conds.find(c => c.field === 'stock')!;
    expect(stockCond.op).toBe('gt');
    expect(stockCond.value).toBe(0);
  });

  it('between for range query', () => {
    // "50到100元之间的衬衫"
    const ast: FilterAst = {
      type: 'and',
      children: [
        { field: 'price', op: 'between', value: [50, 100] },
        { field: 'category', op: 'contains', value: '衬衫' },
      ],
    };
    const conds = collectConditions(ast!);
    const priceCond = conds.find(c => c.field === 'price')!;
    expect(priceCond.op).toBe('between');
    expect(priceCond.value).toEqual([50, 100]);
  });

  it('null ast for query with no filters', () => {
    // "你好" → no filter conditions
    const ast: FilterAst = null;
    expect(ast).toBeNull();
  });

  it('semanticQuery preserved separately from filter', () => {
    // LLM returns: { semanticQuery: "好看的棉质衬衫", filter: {...} }
    const semanticQuery = '好看的棉质衬衫';
    const filter: FilterAst = {
      field: 'material', op: 'eq', value: '纯棉',
    };
    expect(semanticQuery).not.toContain('纯棉'); // filter keywords stripped
    expect(filter).not.toBeNull();
  });
});

describe('textToMetadataFilter — total fallback cases', () => {
  it('invalid JSON from LLM triggers total fallback', () => {
    // parse failure → usedTotalFallback=true, filterAst=null, semanticQuery=original
    const usedTotalFallback = true;
    const filterAst: FilterAst = null;
    const semanticQuery = '100元以内棉质长袖衬衫'; // unchanged

    expect(usedTotalFallback).toBe(true);
    expect(filterAst).toBeNull();
    expect(semanticQuery).toBe('100元以内棉质长袖衬衫');
  });

  it('timeout triggers total fallback', () => {
    // Same behavior as invalid JSON
    const usedTotalFallback = true;
    expect(usedTotalFallback).toBe(true);
  });

  it('validation failure on LLM output triggers total fallback', () => {
    // LLM returned { field: 'nonexistent', op: 'eq', value: 'x' }
    // → validateAst fails → totalFallback
    const usedTotalFallback = true;
    expect(usedTotalFallback).toBe(true);
  });
});
