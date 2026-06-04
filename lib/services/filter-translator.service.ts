/**
 * Filter AST → PostgreSQL JSONB WHERE clause translator.
 *
 * Generates safe, parameterized SQL fragments from a validated FilterAst.
 * All field names are verified against the schema registry.
 * All values use numbered parameters ($1, $2, ...).
 * The translator owns param index management — callers must NOT renumber.
 */

import {
  type FilterAst,
  type FilterCondition,
  type FilterNode,
} from '@/lib/rag/filter-ast';
import { getFieldSchema } from '@/lib/rag/metadata-schema';

export interface TranslationResult {
  /** SQL WHERE clause text (without leading "WHERE") */
  clause: string;
  /** Parameter values in $1, $2, ... order */
  params: unknown[];
}

/**
 * Safe numeric cast: wraps jsonb_extract_path_text with a regex guard
 * so non-numeric values return NULL instead of throwing.
 */
function safeNumericExpr(fieldName: string): string {
  return `
CASE
  WHEN kc.metadata->>'${fieldName}' ~ '^-?[0-9]+(\\.[0-9]+)?$'
  THEN (kc.metadata->>'${fieldName}')::numeric
  ELSE NULL
END`.replace(/\n\s*/g, ' ').trim();
}

/**
 * Simple field access for string/boolean fields.
 */
function stringExpr(fieldName: string): string {
  return `kc.metadata->>'${fieldName}'`;
}

/**
 * Translate a validated Filter AST into a parameterized SQL WHERE fragment.
 *
 * @param ast       Validated filter AST (from text-to-metadata-filter or filter-ast)
 * @param paramOffset  Offset to add to all $N references (e.g., 1 when $1 is already
 *                     consumed by tsquery/vector in the outer query). Callers must
 *                     provide the correct offset so generated params match the full
 *                     parameter array.
 */
export function translateAst(ast: FilterAst, paramOffset: number = 0): TranslationResult {
  if (!ast) return { clause: 'TRUE', params: [] };

  const ctx: TranslationContext = { paramIdx: paramOffset, params: [] };
  const clause = translateNode(ast, ctx);
  return { clause, params: ctx.params };
}

// ── Internal context ──

interface TranslationContext {
  paramIdx: number;
  params: unknown[];
}

function nextParam(ctx: TranslationContext, value: unknown): string {
  ctx.paramIdx++;
  ctx.params.push(value);
  return `$${ctx.paramIdx}`;
}

// ── Node translation ──

function translateNode(node: FilterNode, ctx: TranslationContext): string {
  if (isCondition(node)) {
    return translateCondition(node, ctx);
  }
  switch (node.type) {
    case 'and':
      return `(${node.children.map(c => translateNode(c, ctx)).join(' AND ')})`;
    case 'or':
      return `(${node.children.map(c => translateNode(c, ctx)).join(' OR ')})`;
    case 'not':
      return `NOT (${translateNode(node.child, ctx)})`;
    default:
      return 'TRUE';
  }
}

function isCondition(node: FilterNode): node is FilterCondition {
  return 'field' in node && 'op' in node && !('type' in node);
}

// ── Condition translation ──

function translateCondition(
  cond: FilterCondition,
  ctx: TranslationContext,
): string {
  const schema = getFieldSchema(cond.field);
  if (!schema) return 'TRUE'; // Should never happen after validation

  switch (schema.type) {
    case 'number':
      return translateNumber(cond, ctx);
    case 'boolean':
      return translateBoolean(cond, ctx);
    case 'string':
      return translateString(cond, ctx);
    case 'string[]':
      return translateStringArray(cond, ctx);
    default:
      return 'TRUE';
  }
}

// ── Number conditions ──

function translateNumber(
  cond: FilterCondition,
  ctx: TranslationContext,
): string {
  const expr = safeNumericExpr(cond.field);
  const v = cond.value;

  switch (cond.op) {
    case 'eq':  return `${expr} = ${nextParam(ctx, v)}`;
    case 'ne':  return `(${expr} <> ${nextParam(ctx, v)} OR ${expr} IS NULL)`;
    case 'gt':  return `${expr} > ${nextParam(ctx, v)}`;
    case 'gte': return `${expr} >= ${nextParam(ctx, v)}`;
    case 'lt':  return `${expr} < ${nextParam(ctx, v)}`;
    case 'lte': return `${expr} <= ${nextParam(ctx, v)}`;
    case 'between': {
      const arr = v as [number, number];
      return `${expr} BETWEEN ${nextParam(ctx, arr[0])} AND ${nextParam(ctx, arr[1])}`;
    }
    case 'in': {
      const arr = v as number[];
      if (arr.length === 0) return 'FALSE';
      const params = arr.map(x => nextParam(ctx, x));
      return `${expr} IN (${params.join(', ')})`;
    }
    default: return 'TRUE';
  }
}

// ── Boolean conditions ──

function translateBoolean(
  cond: FilterCondition,
  ctx: TranslationContext,
): string {
  const expr = stringExpr(cond.field);
  const p = nextParam(ctx, cond.value ? 'true' : 'false');
  return cond.op === 'eq' ? `${expr} = ${p}` : `${expr} <> ${p}`;
}

// ── Single string conditions ──

function translateString(
  cond: FilterCondition,
  ctx: TranslationContext,
): string {
  const expr = stringExpr(cond.field);

  switch (cond.op) {
    case 'eq':
      return `${expr} = ${nextParam(ctx, cond.value)}`;
    case 'ne':
      return `(${expr} <> ${nextParam(ctx, cond.value)} OR ${expr} IS NULL)`;
    case 'contains':
      return `${expr} ILIKE ${nextParam(ctx, `%${cond.value}%`)}`;
    case 'in': {
      const arr = cond.value as string[];
      if (arr.length === 0) return 'FALSE';
      const params = arr.map(x => nextParam(ctx, x));
      return `${expr} IN (${params.join(', ')})`;
    }
    default: return 'TRUE';
  }
}

// ── string[] conditions (historical compat: may be array OR plain string) ──

/**
 * string[] contains:
 *   metadata field may hold a JSON array OR a plain string (historical).
 *   Match with JSONB containment @> AND ILIKE, using TWO independent params.
 *
 *   SQL:
 *   (
 *     kc.metadata->'scene' @> $1::jsonb
 *     OR jsonb_extract_path_text(kc.metadata, 'scene') ILIKE $2
 *   )
 */
function translateStringArrayContains(
  cond: FilterCondition,
  ctx: TranslationContext,
): string {
  const field = cond.field;
  const value = cond.value as string;
  const jsonParam = nextParam(ctx, JSON.stringify([value]));
  const ilikeParam = nextParam(ctx, `%${value}%`);

  return `(
  kc.metadata->'${field}' @> ${jsonParam}::jsonb
  OR kc.metadata->>'${field}' ILIKE ${ilikeParam}
)`;
}

/**
 * string[] in:
 *   Each candidate value generates its own JSONB param AND its own ILIKE param.
 *   Params are NOT shared across values.
 *
 *   SQL:
 *   (
 *     kc.metadata->'season' @> $1::jsonb
 *     OR jsonb_extract_path_text(kc.metadata, 'season') ILIKE $2
 *     OR kc.metadata->'season' @> $3::jsonb
 *     OR jsonb_extract_path_text(kc.metadata, 'season') ILIKE $4
 *   )
 */
function translateStringArrayIn(
  cond: FilterCondition,
  ctx: TranslationContext,
): string {
  const field = cond.field;
  const values = cond.value as string[];
  if (values.length === 0) return 'FALSE';

  const parts: string[] = [];
  for (const v of values) {
    const jsonParam = nextParam(ctx, JSON.stringify([v]));
    const ilikeParam = nextParam(ctx, `%${v}%`);
    parts.push(
      `kc.metadata->'${field}' @> ${jsonParam}::jsonb`,
      `kc.metadata->>'${field}' ILIKE ${ilikeParam}`,
    );
  }
  return `(${parts.join(' OR ')})`;
}

function translateStringArray(
  cond: FilterCondition,
  ctx: TranslationContext,
): string {
  switch (cond.op) {
    case 'contains':
      return translateStringArrayContains(cond, ctx);
    case 'in':
      return translateStringArrayIn(cond, ctx);
    case 'eq': {
      // eq on string[]: match via ILIKE (historical string compat)
      const expr = stringExpr(cond.field);
      return `${expr} ILIKE ${nextParam(ctx, `%${cond.value}%`)}`;
    }
    default:
      return 'TRUE';
  }
}
