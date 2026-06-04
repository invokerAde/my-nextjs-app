import { validateAst, deriveFallbackAst, collectConditions } from '@/lib/rag/filter-ast';
import type { FilterAst, FilterNode } from '@/lib/rag/filter-ast';

describe('validateAst', () => {
  it('accepts valid single condition', () => {
    const ast: FilterAst = { field: 'price', op: 'lte', value: 100 };
    const result = validateAst(ast);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts valid and node', () => {
    const ast: FilterAst = {
      type: 'and',
      children: [
        { field: 'price', op: 'lte', value: 100 },
        { field: 'material', op: 'eq', value: '纯棉' },
      ],
    };
    const result = validateAst(ast);
    expect(result.valid).toBe(true);
  });

  it('rejects unknown field', () => {
    const ast: FilterAst = { field: 'nonexistent', op: 'eq', value: 'x' };
    const result = validateAst(ast);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Unknown'))).toBe(true);
  });

  it('rejects illegal operator on field', () => {
    const ast: FilterAst = { field: 'material', op: 'gt', value: '纯棉' };
    const result = validateAst(ast);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('not allowed'))).toBe(true);
  });

  it('rejects invalid enum value', () => {
    const ast: FilterAst = { field: 'material', op: 'eq', value: '花岗岩' };
    const result = validateAst(ast);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Invalid enum'))).toBe(true);
  });

  it('accepts in operator on string with valid enum values', () => {
    const ast: FilterAst = { field: 'material', op: 'in', value: ['纯棉', '真丝'] };
    const result = validateAst(ast);
    expect(result.valid).toBe(true);
  });

  it('rejects in with invalid enum value in array', () => {
    const ast: FilterAst = { field: 'material', op: 'in', value: ['纯棉', '花岗岩'] };
    const result = validateAst(ast);
    expect(result.valid).toBe(false);
  });

  it('rejects between without [min, max]', () => {
    const ast: FilterAst = { field: 'price', op: 'between', value: 100 };
    const result = validateAst(ast);
    expect(result.valid).toBe(false);
  });

  it('accepts valid between', () => {
    const ast: FilterAst = { field: 'price', op: 'between', value: [50, 100] };
    const result = validateAst(ast);
    expect(result.valid).toBe(true);
  });

  it('accepts string[] in with multiple enum values', () => {
    const ast: FilterAst = { field: 'season', op: 'in', value: ['春秋', '夏季'] };
    const result = validateAst(ast);
    expect(result.valid).toBe(true);
  });

  it('accepts string[] contains with valid enum', () => {
    const ast: FilterAst = { field: 'scene', op: 'contains', value: '上班' };
    const result = validateAst(ast);
    expect(result.valid).toBe(true);
  });

  it('rejects empty and node', () => {
    const ast: FilterAst = { type: 'and', children: [] };
    const result = validateAst(ast);
    expect(result.valid).toBe(false);
  });

  it('validates nested and/or/not structures', () => {
    const ast: FilterAst = {
      type: 'and',
      children: [
        { field: 'price', op: 'lte', value: 100 },
        {
          type: 'or',
          children: [
            { field: 'material', op: 'eq', value: '纯棉' },
            { field: 'material', op: 'eq', value: '真丝' },
          ],
        },
      ],
    };
    const result = validateAst(ast);
    expect(result.valid).toBe(true);
  });
});

describe('deriveFallbackAst', () => {
  it('returns null for null input', () => {
    expect(deriveFallbackAst(null)).toBeNull();
  });

  it('keeps hard conditions (category, brand)', () => {
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
    // Soft conditions may be dropped
    expect(fields).not.toContain('price');
  });

  it('keeps top-priority soft conditions when no hard exist', () => {
    const ast: FilterAst = {
      type: 'and',
      children: [
        { field: 'price', op: 'lte', value: 100 },
        { field: 'material', op: 'eq', value: '纯棉' },
        { field: 'season', op: 'in', value: ['春秋'] },
      ],
    };
    const fallback = deriveFallbackAst(ast);
    expect(fallback).not.toBeNull();
    const conds = collectConditions(fallback!);
    expect(conds.length).toBeGreaterThanOrEqual(1);
    expect(conds.length).toBeLessThanOrEqual(3);
    // price has fallbackPriority=1, should be first
    expect(conds[0].field).toBe('price');
  });

  it('single condition input is handled', () => {
    const fallback = deriveFallbackAst({ field: 'price', op: 'lte', value: 100 });
    expect(fallback).not.toBeNull();
    const conds = collectConditions(fallback!);
    expect(conds).toHaveLength(1);
    expect(conds[0].field).toBe('price');
  });
});

describe('collectConditions', () => {
  it('flattens nested and/or', () => {
    const node: FilterNode = {
      type: 'and',
      children: [
        { field: 'price', op: 'lte', value: 100 },
        {
          type: 'or',
          children: [
            { field: 'material', op: 'eq', value: '纯棉' },
            { field: 'material', op: 'eq', value: '真丝' },
          ],
        },
      ],
    };
    const conds = collectConditions(node);
    expect(conds).toHaveLength(3);
    expect(conds.map(c => c.field)).toEqual(['price', 'material', 'material']);
  });
});
