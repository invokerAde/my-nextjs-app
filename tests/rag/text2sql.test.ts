import { validateSQL } from '@/lib/services/text2sql/validate';

describe('Text2SQL validation', () => {
  it('rejects empty SQL', () => {
    expect(validateSQL('')).toBe(false);
    expect(validateSQL('SEL')).toBe(false);
  });

  it('rejects INSERT statement', () => {
    expect(validateSQL('INSERT INTO product_search_view VALUES (1)')).toBe(false);
  });

  it('rejects DROP statement', () => {
    expect(validateSQL('DROP TABLE product_search_view')).toBe(false);
  });

  it('rejects SQL without whitelist table', () => {
    expect(validateSQL('SELECT * FROM "Product"')).toBe(false);
  });

  it('accepts valid SELECT on whitelist view', () => {
    expect(validateSQL("SELECT * FROM product_search_view WHERE name ILIKE '%棉%'")).toBe(true);
  });

  it('rejects UPDATE even with whitelist table', () => {
    expect(validateSQL("UPDATE product_search_view SET name = 'x'")).toBe(false);
  });
});
