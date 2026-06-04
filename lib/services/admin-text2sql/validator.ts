/**
 * SQL Validator for Admin Text2SQL — uses SQL AST parser (node-sql-parser).
 */

import { Parser } from 'node-sql-parser';
import { ANALYTICS_VIEWS } from './knowledge';

const parser = new Parser();
const MAX_ROWS_DEFAULT = 100;

export interface ValidationResult {
  valid: boolean;
  sql: string;
  error?: string;
}

export function validateAdminSQL(
  sql: string,
  maxRows: number = MAX_ROWS_DEFAULT,
): ValidationResult {
  const trimmed = sql.trim();
  if (!trimmed || trimmed.length < 6) {
    return { valid: false, sql: trimmed, error: 'SQL is empty or too short' };
  }

  // 1. Reject SQL comments
  if (/--/.test(trimmed) || /\/\*/.test(trimmed)) {
    return { valid: false, sql: trimmed, error: 'SQL comments are not allowed' };
  }

  // 2. AST parse
  let ast: any;
  try {
    ast = parser.astify(trimmed, { database: 'PostgresQL' });
  } catch (err: any) {
    return { valid: false, sql: trimmed, error: `SQL parse error: ${err.message}` };
  }

  // 3. Multi-statement check
  if (Array.isArray(ast) && ast.length > 1) {
    return { valid: false, sql: trimmed, error: 'Multi-statement SQL is not allowed' };
  }
  const statement = Array.isArray(ast) ? ast[0] : ast;

  // 4. Type check
  const DISALLOWED = ['insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate', 'replace'];
  if (statement && DISALLOWED.includes(statement.type)) {
    return { valid: false, sql: trimmed, error: `Forbidden statement type: ${statement.type.toUpperCase()}` };
  }
  if (statement && statement.type !== 'select') {
    return { valid: false, sql: trimmed, error: `Only SELECT allowed, got: ${statement.type}` };
  }

  // 5. Extract ALL table refs (includes UNION, subqueries, CTE, EXISTS, scalar)
  const tableRefs = extractAllTableRefs(statement);

  // 6. Whitelist check
  for (const ref of tableRefs) {
    if (!ANALYTICS_VIEWS.some(v => v.toLowerCase() === ref)) {
      return {
        valid: false, sql: trimmed,
        error: `Table/view "${ref}" is not in the analytics whitelist. Allowed: ${ANALYTICS_VIEWS.join(', ')}`,
      };
    }
  }

  // 7. LIMIT
  return applyLimit(trimmed, maxRows);
}

// ── Full AST traversal ──

function extractAllTableRefs(root: any): string[] {
  const refs = new Set<string>();
  const cteNames = new Set<string>();
  walk(root, cteNames, refs);
  return [...refs].filter(r => !cteNames.has(r));
}

function walk(node: any, cteNames: Set<string>, refs: Set<string>): void {
  if (!node || typeof node !== 'object') return;

  // Collect CTE names from WITH clause
  if (node.with && Array.isArray(node.with)) {
    for (const cte of node.with) {
      const name = typeof cte.name === 'string' ? cte.name : cte.name?.value;
      if (name) cteNames.add(String(name).toLowerCase());
      // Walk CTE body
      if (cte.stmt) walk(cte.stmt, cteNames, refs);
    }
  }

  // FROM tables
  if (node.from && Array.isArray(node.from)) {
    for (const f of node.from) {
      if (f.table) refs.add(String(f.table).toLowerCase());
      if (f.expr && f.expr.type === 'select') walk(f.expr, cteNames, refs);
    }
  }

  // UNION chain (_next)
  if (node._next) walk(node._next, cteNames, refs);

  // WHERE — EXISTS / IN subqueries
  if (node.where) {
    const subqueries = findSubqueries(node.where);
    for (const sq of subqueries) walk(sq, cteNames, refs);
  }

  // SELECT columns — scalar subqueries
  if (node.columns && Array.isArray(node.columns)) {
    for (const col of node.columns) {
      const subqueries = findSubqueries(col);
      for (const sq of subqueries) walk(sq, cteNames, refs);
    }
  }

  // HAVING subqueries
  if (node.having) {
    const subqueries = findSubqueries(node.having);
    for (const sq of subqueries) walk(sq, cteNames, refs);
  }
}

/** Deep-walk any subtree for embedded SELECT AST nodes. */
function findSubqueries(node: any): any[] {
  const results: any[] = [];
  if (!node || typeof node !== 'object') return results;

  // Direct subquery in EXISTS / IN (e.g., args.value[0].ast)
  if (node.args?.value && Array.isArray(node.args.value)) {
    for (const v of node.args.value) {
      if (v.ast && v.ast.type === 'select') results.push(v.ast);
      results.push(...findSubqueries(v));
    }
  }

  // expr subquery
  if (node.expr) {
    if (node.expr.ast && node.expr.ast.type === 'select') results.push(node.expr.ast);
    results.push(...findSubqueries(node.expr));
  }

  // left/right for binary expressions
  if (node.left) results.push(...findSubqueries(node.left));
  if (node.right) results.push(...findSubqueries(node.right));

  return results;
}

// ── LIMIT ──

function applyLimit(sql: string, maxRows: number): ValidationResult {
  let trimmed = sql.trim().replace(/;+$/, '');
  const m = trimmed.match(/\bLIMIT\s+(\d+)\s*$/i);
  if (m) {
    if (parseInt(m[1], 10) > maxRows) {
      trimmed = trimmed.replace(/\bLIMIT\s+\d+\s*$/i, `LIMIT ${maxRows}`);
    }
    return { valid: true, sql: trimmed };
  }
  return { valid: true, sql: `${trimmed} LIMIT ${maxRows}` };
}

export function validateQuestion(q: string): { valid: boolean; error?: string } {
  if (!q || q.trim().length < 2) return { valid: false, error: 'Question too short' };
  if (q.length > 2000) return { valid: false, error: 'Question too long (max 2000)' };
  return { valid: true };
}
