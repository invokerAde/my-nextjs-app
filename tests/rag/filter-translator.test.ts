import { translateAst } from '@/lib/services/filter-translator.service';
import type { FilterAst } from '@/lib/rag/filter-ast';

describe('translateAst', () => {
  it('returns TRUE for null ast', () => {
    const result = translateAst(null);
    expect(result.clause).toBe('TRUE');
    expect(result.params).toHaveLength(0);
  });

  describe('number fields', () => {
    it('generates safe numeric cast for price lte', () => {
      const ast: FilterAst = { field: 'price', op: 'lte', value: 100 };
      const result = translateAst(ast);
      expect(result.clause).toContain('CASE');
      expect(result.clause).toContain("~ '^-?[0-9]+(\\.[0-9]+)?$'");
      expect(result.clause).toContain('::numeric');
      expect(result.params).toEqual([100]);
    });

    it('generates between clause', () => {
      const ast: FilterAst = { field: 'price', op: 'between', value: [50, 100] };
      const result = translateAst(ast);
      expect(result.clause).toContain('BETWEEN');
      expect(result.params).toEqual([50, 100]);
    });

    it('parameterizes values (no inline numbers)', () => {
      const ast: FilterAst = { field: 'rating', op: 'gte', value: 4 };
      const result = translateAst(ast);
      // Value 4 should NOT appear directly in SQL
      expect(result.clause).toContain('$1');
      expect(result.params).toEqual([4]);
    });
  });

  describe('string fields', () => {
    it('generates simple eq for string', () => {
      const ast: FilterAst = { field: 'material', op: 'eq', value: '纯棉' };
      const result = translateAst(ast);
      expect(result.clause).toContain('kc.metadata->>');
      expect(result.clause).toContain("'material'");
      expect(result.params).toEqual(['纯棉']);
    });

    it('generates ILIKE for contains', () => {
      const ast: FilterAst = { field: 'category', op: 'contains', value: '衬衫' };
      const result = translateAst(ast);
      expect(result.clause).toContain('ILIKE');
      expect(result.params).toEqual(['%衬衫%']);
    });
  });

  describe('string[] fields', () => {
    it('string[] contains generates JSONB + ILIKE with independent params', () => {
      const ast: FilterAst = { field: 'scene', op: 'contains', value: '上班' };
      const result = translateAst(ast);
      // JSONB containment
      expect(result.clause).toContain("@> $1::jsonb");
      // ILIKE for historical string compat
      expect(result.clause).toContain("ILIKE $2");
      // Separate params, not shared
      expect(result.params).toEqual([JSON.stringify(['上班']), '%上班%']);
    });

    it('string[] in generates independent param pairs per value', () => {
      const ast: FilterAst = { field: 'season', op: 'in', value: ['春秋', '夏季'] };
      const result = translateAst(ast);
      // Two values × two params each = 4 params
      expect(result.clause.match(/@> \$\d+::jsonb/g)?.length).toBe(2);
      expect(result.clause.match(/ILIKE \$\d+/g)?.length).toBe(2);
      // Params: [json1, ilike1, json2, ilike2]
      expect(result.params).toHaveLength(4);
      expect(result.params[0]).toBe(JSON.stringify(['春秋']));
      expect(result.params[1]).toBe('%春秋%');
      expect(result.params[2]).toBe(JSON.stringify(['夏季']));
      expect(result.params[3]).toBe('%夏季%');
    });

    it('param indices are sequential and increasing', () => {
      const ast: FilterAst = { field: 'season', op: 'in', value: ['春秋', '夏季'] };
      const result = translateAst(ast);
      // Extract all $N references
      const refs = result.clause.match(/\$(\d+)/g) || [];
      const nums = refs.map(r => Number(r.slice(1)));
      // Should be [1,2,3,4]
      expect(nums).toEqual([1, 2, 3, 4]);
    });
  });

  describe('compound expressions', () => {
    it('translates and with multiple conditions', () => {
      const ast: FilterAst = {
        type: 'and',
        children: [
          { field: 'price', op: 'lte', value: 100 },
          { field: 'material', op: 'eq', value: '纯棉' },
        ],
      };
      const result = translateAst(ast);
      expect(result.clause).toContain(' AND ');
      expect(result.params).toEqual([100, '纯棉']);
    });

    it('SQL injection in value is parameterized, not inlined', () => {
      const ast: FilterAst = { field: 'material', op: 'eq', value: "'; DROP TABLE--" };
      const result = translateAst(ast);
      expect(result.clause).not.toContain('DROP');
      expect(result.clause).not.toContain("';");
      expect(result.params).toEqual(["'; DROP TABLE--"]);
    });

    it('field name is NOT parameterized (must be from schema)', () => {
      const ast: FilterAst = { field: 'price', op: 'lt', value: 50 };
      const result = translateAst(ast);
      // Field name 'price' appears as literal in SQL (verified by schema)
      expect(result.clause).toContain("'price'");
      // But value is parameterized
      expect(result.params).toEqual([50]);
    });
  });
});
