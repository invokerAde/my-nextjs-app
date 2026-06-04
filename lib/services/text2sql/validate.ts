/**
 * Pure SQL validation — no database dependencies.
 * Safe to import in Jest tests without Prisma ESM issues.
 */

const ALLOWED_TABLES = ['product_search_view'];
const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE',
  'TRUNCATE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE',
];

const MAX_ROWS = Number(process.env.TEXT2SQL_MAX_ROWS) || 50;

export function validateSQL(sql: string): boolean {
  if (!sql || sql.length < 5) return false;
  const upper = sql.toUpperCase();
  for (const kw of FORBIDDEN_KEYWORDS) {
    if (upper.includes(kw)) return false;
  }
  return ALLOWED_TABLES.some(t => sql.includes(t));
}

export function addRowLimit(sql: string): string {
  const trimmed = sql.trim().replace(/;+$/, '');
  if (/LIMIT\s+\d+/i.test(trimmed)) return trimmed;
  return `${trimmed} LIMIT ${MAX_ROWS}`;
}
