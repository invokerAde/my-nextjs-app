import { validateAdminSQL } from '@/lib/services/admin-text2sql/validator';

describe('validateAdminSQL', () => {
  // ── Valid SQL ──

  it('accepts simple SELECT from analytics view', () => {
    const r = validateAdminSQL(
      'SELECT product_name, price FROM admin_product_analytics_view LIMIT 10',
    );
    expect(r.valid).toBe(true);
    expect(r.sql).toContain('LIMIT 10');
  });

  it('accepts SELECT with GROUP BY and aggregate', () => {
    const r = validateAdminSQL(
      'SELECT category, COUNT(*)::int FROM admin_product_analytics_view GROUP BY category',
    );
    expect(r.valid).toBe(true);
    expect(r.sql).toContain('LIMIT');
  });

  it('accepts WITH ... SELECT (CTE)', () => {
    const r = validateAdminSQL(
      `WITH top AS (SELECT product_id, price FROM admin_product_analytics_view ORDER BY price DESC LIMIT 5)
       SELECT * FROM top`,
    );
    expect(r.valid).toBe(true);
  });

  it('auto-appends LIMIT when missing', () => {
    const r = validateAdminSQL(
      'SELECT * FROM admin_product_analytics_view',
    );
    expect(r.valid).toBe(true);
    expect(r.sql).toContain('LIMIT 100');
  });

  it('caps LIMIT to maxRows', () => {
    const r = validateAdminSQL(
      'SELECT * FROM admin_product_analytics_view LIMIT 9999',
      50,
    );
    expect(r.valid).toBe(true);
    expect(r.sql).toContain('LIMIT 50');
    expect(r.sql).not.toContain('9999');
  });

  it('accepts JOIN between analytics views', () => {
    const r = validateAdminSQL(
      `SELECT p.product_name, SUM(o.quantity)::int AS sold
       FROM admin_product_analytics_view p
       JOIN admin_order_analytics_view o ON o.product_id = p.product_id
       GROUP BY p.product_name
       ORDER BY sold DESC LIMIT 10`,
    );
    expect(r.valid).toBe(true);
  });

  it('accepts all analytics view names', () => {
    for (const view of [
      'admin_product_analytics_view',
      'admin_order_analytics_view',
      'admin_review_analytics_view',
      'admin_customer_summary_view',
    ]) {
      const r = validateAdminSQL(`SELECT * FROM ${view} LIMIT 1`);
      expect(r.valid).toBe(true);
    }
  });

  // ── Rejected SQL (AST parse errors) ──

  it('rejects INSERT (type check)', () => {
    const r = validateAdminSQL('INSERT INTO admin_product_analytics_view VALUES (1)');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('Forbidden statement type');
  });

  it('rejects DELETE (type check)', () => {
    const r = validateAdminSQL('DELETE FROM admin_product_analytics_view');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('Forbidden statement type');
  });

  it('rejects DROP (type check)', () => {
    const r = validateAdminSQL('DROP TABLE admin_product_analytics_view');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('Forbidden statement type');
  });

  it('rejects multi-statement SQL', () => {
    const r = validateAdminSQL('SELECT * FROM admin_product_analytics_view LIMIT 1; SELECT * FROM admin_order_analytics_view LIMIT 1');
    expect(r.valid).toBe(false);
  });

  // ── Rejected SQL (whitelist check) ──

  it('rejects raw Product table access', () => {
    const r = validateAdminSQL('SELECT * FROM Product LIMIT 1');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('not in the analytics whitelist');
  });

  it('rejects raw User table access', () => {
    const r = validateAdminSQL('SELECT * FROM "User" LIMIT 1');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('not in the analytics whitelist');
  });

  it('rejects raw Order table access', () => {
    const r = validateAdminSQL('SELECT * FROM "Order" LIMIT 1');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('not in the analytics whitelist');
  });

  it('rejects unknown view names', () => {
    const r = validateAdminSQL('SELECT * FROM unknown_view LIMIT 1');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('not in the analytics whitelist');
  });

  it('rejects KnowledgeChunk raw access', () => {
    const r = validateAdminSQL('SELECT * FROM "KnowledgeChunk"');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('not in the analytics whitelist');
  });

  it('rejects empty SQL', () => {
    const r = validateAdminSQL('');
    expect(r.valid).toBe(false);
  });

  it('rejects non-SELECT start', () => {
    const r = validateAdminSQL('EXPLAIN SELECT * FROM admin_product_analytics_view');
    expect(r.valid).toBe(false);
  });

  it('rejects all-caps INSERT variant', () => {
    const r = validateAdminSQL('INSERT INTO admin_product_analytics_view VALUES (1)');
    expect(r.valid).toBe(false);
  });

  // ── Comment handling ──

  it('rejects SQL with line comments', () => {
    const r = validateAdminSQL(
      'SELECT product_name FROM admin_product_analytics_view -- comment\nLIMIT 1',
    );
    expect(r.valid).toBe(false);
    expect(r.error).toContain('comments');
  });

  it('rejects SQL with block comments', () => {
    const r = validateAdminSQL(
      'SELECT product_name FROM admin_product_analytics_view /* inline */ LIMIT 1',
    );
    expect(r.valid).toBe(false);
    expect(r.error).toContain('comments');
  });

  // ── UNION / EXISTS / scalar subquery bypass checks ──

  it('rejects UNION with raw table in second branch', () => {
    const r = validateAdminSQL(
      'SELECT * FROM admin_product_analytics_view UNION SELECT * FROM "User"',
    );
    expect(r.valid).toBe(false);
    expect(r.error).toContain('not in the analytics whitelist');
  });

  it('rejects WHERE EXISTS referencing raw table', () => {
    const r = validateAdminSQL(
      'SELECT * FROM admin_product_analytics_view WHERE EXISTS (SELECT 1 FROM "User")',
    );
    expect(r.valid).toBe(false);
    expect(r.error).toContain('not in the analytics whitelist');
  });

  it('rejects scalar subquery referencing raw table', () => {
    const r = validateAdminSQL(
      'SELECT (SELECT COUNT(*) FROM "User") FROM admin_product_analytics_view',
    );
    expect(r.valid).toBe(false);
    expect(r.error).toContain('not in the analytics whitelist');
  });

  it('rejects UNION ALL with raw table', () => {
    const r = validateAdminSQL(
      'SELECT * FROM admin_product_analytics_view UNION ALL SELECT * FROM "Order"',
    );
    expect(r.valid).toBe(false);
    expect(r.error).toContain('not in the analytics whitelist');
  });
});
