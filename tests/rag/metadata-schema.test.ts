import {
  METADATA_SCHEMA,
  getFieldSchema,
  getAllFieldNames,
  getHardFieldNames,
} from '@/lib/rag/metadata-schema';

describe('METADATA_SCHEMA', () => {
  it('all fields have unique names', () => {
    const names = METADATA_SCHEMA.map(f => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('category and brand are hard filters', () => {
    const cat = getFieldSchema('category');
    const brand = getFieldSchema('brand');
    expect(cat?.filterStrength).toBe('hard');
    expect(brand?.filterStrength).toBe('hard');
  });

  it('price, rating, stock are soft number filters', () => {
    for (const name of ['price', 'rating', 'stock']) {
      const s = getFieldSchema(name);
      expect(s?.type).toBe('number');
      expect(s?.filterStrength).toBe('soft');
    }
  });

  it('enum fields declare enumValues', () => {
    for (const f of METADATA_SCHEMA) {
      if (['material', 'fit', 'collar', 'sleeveLength', 'thickness', 'stretch',
           'breathability', 'season', 'scene', 'sizeAdvice'].includes(f.name)) {
        expect(f.enumValues).toBeDefined();
        expect(f.enumValues!.length).toBeGreaterThan(0);
      }
    }
  });

  it('string[] fields (season, scene) allow in and contains', () => {
    for (const name of ['season', 'scene']) {
      const s = getFieldSchema(name);
      expect(s?.type).toBe('string[]');
      expect(s?.operators).toContain('in');
      expect(s?.operators).toContain('contains');
    }
  });

  it('number fields include comparison operators', () => {
    const price = getFieldSchema('price');
    expect(price?.operators).toContain('gt');
    expect(price?.operators).toContain('gte');
    expect(price?.operators).toContain('lt');
    expect(price?.operators).toContain('lte');
    expect(price?.operators).toContain('between');
  });

  it('getAllFieldNames returns all names', () => {
    expect(getAllFieldNames()).toEqual(METADATA_SCHEMA.map(f => f.name));
  });

  it('getHardFieldNames returns only hard fields', () => {
    const hard = getHardFieldNames();
    expect(hard).toContain('category');
    expect(hard).toContain('brand');
    expect(hard).not.toContain('price');
    expect(hard).not.toContain('material');
  });

  it('soft fields have fallbackPriority', () => {
    for (const f of METADATA_SCHEMA) {
      if (f.filterStrength === 'soft') {
        expect(typeof f.fallbackPriority).toBe('number');
      }
    }
  });
});
