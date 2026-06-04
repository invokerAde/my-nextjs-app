/**
 * SQL Validator for Admin Text2SQL.
 *
 * Rules:
 * - Only SELECT (or WITH ... SELECT) allowed
 * - No DML/DDL keywords
 * - No multi-statement (; inside SQL)
 * - No comment escapes (--, / * * /)
 * - All FROM/JOIN table references must be in the whitelist
 * - No raw table access (Product, User, Order, Review, ...)
 * - LIMIT is capped to TEXT2SQL_MAX_ROWS; missing LIMIT is appended
 */

import { ANALYTICS_VIEWS, type AnalyticsView } from './knowledge';

const MAX_ROWS_DEFAULT = 100;

const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE',
  'TRUNCATE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE',
  'REPLACE', 'MERGE', 'COPY', 'CALL', 'DO',
];

// Tables/views that must never appear directly in SQL
const FORBIDDEN_TABLES = [
  'Product', 'User', 'Order', 'OrderItem', 'Review',
  'Cart', 'Account', 'Session', 'VerificationToken',
  'ProductSpec', 'ReviewInsight',
  'KnowledgeDocument', 'KnowledgeChunk',
];

export interface ValidationResult {
  valid: boolean;
  sql: string;           // Normalized SQL (LIMIT-added)
  error?: string;
}

/**
 * Validate a generated SQL string against all rules.
 * Returns normalized SQL with LIMIT applied.
 */
export function validateAdminSQL(
  sql: string,
  maxRows: number = MAX_ROWS_DEFAULT,
): ValidationResult {
  const trimmed = sql.trim();

  // 1. Non-empty
  if (!trimmed || trimmed.length < 6) {
    return { valid: false, sql: trimmed, error: 'SQL is empty or too short' };
  }

  const upper = trimmed.toUpperCase();

  // 2. No forbidden keywords
  for (const kw of FORBIDDEN_KEYWORDS) {
    // Match whole words only (not substrings of identifiers)
    if (new RegExp(`\\b${kw}\\b`, 'i').test(trimmed)) {
      return { valid: false, sql: trimmed, error: `Forbidden keyword: ${kw}` };
    }
  }

  // 3. Must start with SELECT or WITH
  if (!/^(SELECT|WITH)\b/i.test(trimmed)) {
    return { valid: false, sql: trimmed, error: 'SQL must start with SELECT or WITH' };
  }

  // 4. No multi-statement (semicolons inside, excluding trailing)
  const body = trimmed.replace(/;+$/, '');
  if (body.includes(';')) {
    return { valid: false, sql: trimmed, error: 'Multi-statement SQL is not allowed' };
  }

  // 5. No comment escapes
  if (/--/.test(trimmed) || /\/\*/.test(trimmed)) {
    return { valid: false, sql: trimmed, error: 'SQL comments are not allowed' };
  }

  // 6. Extract table/view references from FROM and JOIN clauses
  const tableRefs = extractTableReferences(trimmed);

  // 7. All referenced tables must be in the whitelist
  for (const ref of tableRefs) {
    if (FORBIDDEN_TABLES.some(t => t.toLowerCase() === ref.toLowerCase())) {
      return {
        valid: false,
        sql: trimmed,
        error: `Direct access to "${ref}" is forbidden. Use analytics views only.`,
      };
    }
    if (!ANALYTICS_VIEWS.some(v => v.toLowerCase() === ref.toLowerCase())) {
      return {
        valid: false,
        sql: trimmed,
        error: `Unknown table/view "${ref}". Only analytics views are allowed: ${ANALYTICS_VIEWS.join(', ')}`,
      };
    }
  }

  if (tableRefs.length === 0) {
    return { valid: false, sql: trimmed, error: 'No table references found in SQL' };
  }

  // 8. LIMIT handling
  return applyLimit(trimmed, maxRows);
}

/**
 * Extract table/view names from FROM and JOIN clauses.
 * Handles: FROM "Table", FROM schema."Table", FROM Table, JOIN "Table", etc.
 * CTE alias names (defined in WITH clause) are excluded.
 */
function extractTableReferences(sql: string): string[] {
  // First, extract CTE alias names from WITH clause
  const cteNames = new Set<string>();
  const withPart = sql.match(/WITH\s+(.+?)\s+AS\s*\(/gis);
  if (withPart) {
    for (const w of withPart) {
      const m = w.match(/WITH\s+([\w"]+)\s+AS\s*\(/i);
      if (m) {
        cteNames.add(m[1].replace(/"/g, '').toLowerCase());
      }
    }
  }

  const refs: string[] = [];
  // Match FROM/JOIN followed by an identifier (quoted or unquoted)
  const pattern = /(?:FROM|JOIN)\s+(?:[\w"]+\.)?(?:"([^"]+)"|(\w+))/gi;
  let match;
  while ((match = pattern.exec(sql)) !== null) {
    const name = (match[1] || match[2] || '').toLowerCase();
    if (name && !/^(SELECT|WITH|ON|WHERE|AND|OR|NOT|IN|AS)$/i.test(name)) {
      // Skip CTE alias names
      if (!cteNames.has(name)) {
        refs.push(name);
      }
    }
  }
  return [...new Set(refs)];
}

/** Ensure LIMIT exists and is capped. */
function applyLimit(sql: string, maxRows: number): ValidationResult {
  let trimmed = sql.trim().replace(/;+$/, '');
  const limitMatch = trimmed.match(/\bLIMIT\s+(\d+)\s*$/i);

  if (limitMatch) {
    const existingLimit = parseInt(limitMatch[1], 10);
    if (existingLimit > maxRows) {
      // Cap to maxRows
      trimmed = trimmed.replace(/\bLIMIT\s+\d+\s*$/i, `LIMIT ${maxRows}`);
    }
    return { valid: true, sql: trimmed };
  }

  // No LIMIT — append one
  return { valid: true, sql: `${trimmed} LIMIT ${maxRows}` };
}

/**
 * Lightweight pre-validation that doesn't require SQL parsing.
 * Use before LLM generation to validate user input (not SQL).
 */
export function validateQuestion(question: string): { valid: boolean; error?: string } {
  if (!question || question.trim().length < 2) {
    return { valid: false, error: 'Question is too short' };
  }
  if (question.length > 2000) {
    return { valid: false, error: 'Question is too long (max 2000 chars)' };
  }
  return { valid: true };
}
