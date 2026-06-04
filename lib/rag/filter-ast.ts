/**
 * Filter AST — the validated intermediate representation between LLM output
 * and SQL translation.  All nodes are validated against the schema registry.
 */

import {
  type FilterOperator,
  type MetadataFieldSchema,
  getFieldSchema,
  getHardFieldNames,
  METADATA_SCHEMA,
} from '@/lib/rag/metadata-schema';

// ── AST node types ──

export interface FilterCondition {
  field: string;
  op: FilterOperator;
  value: unknown;
}

export interface FilterAnd {
  type: 'and';
  children: FilterNode[];
}

export interface FilterOr {
  type: 'or';
  children: FilterNode[];
}

export interface FilterNot {
  type: 'not';
  child: FilterNode;
}

export type FilterNode = FilterAnd | FilterOr | FilterNot | FilterCondition;

export type FilterAst = FilterNode | null;

// ── Validation error ──

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ── Validation ──

function isFilterCondition(node: FilterNode): node is FilterCondition {
  return 'field' in node && 'op' in node && 'value' in node;
}

export function validateAst(ast: FilterAst): ValidationResult {
  const errors: ValidationError[] = [];
  if (!ast) return { valid: true, errors: [] };
  validateNode(ast, '$', errors);
  return { valid: errors.length === 0, errors };
}

function validateNode(
  node: FilterNode,
  path: string,
  errors: ValidationError[],
): void {
  if (isFilterCondition(node)) {
    validateCondition(node, path, errors);
  } else if (node.type === 'and' || node.type === 'or') {
    if (!Array.isArray(node.children) || node.children.length === 0) {
      errors.push({ path, message: `${node.type} must have at least one child` });
      return;
    }
    for (let i = 0; i < node.children.length; i++) {
      validateNode(node.children[i], `${path}.children[${i}]`, errors);
    }
  } else if (node.type === 'not') {
    if (!node.child) {
      errors.push({ path, message: 'not must have a child' });
      return;
    }
    validateNode(node.child, `${path}.child`, errors);
  } else {
    errors.push({ path, message: `Unknown node type: ${(node as any).type}` });
  }
}

function validateCondition(
  cond: FilterCondition,
  path: string,
  errors: ValidationError[],
): void {
  const schema = getFieldSchema(cond.field);
  if (!schema) {
    errors.push({ path, message: `Unknown field: "${cond.field}"` });
    return;
  }

  if (!schema.operators.includes(cond.op)) {
    errors.push({
      path,
      message: `Operator "${cond.op}" not allowed on field "${cond.field}". Allowed: ${schema.operators.join(', ')}`,
    });
  }

  validateValue(schema, cond, path, errors);
}

function validateValue(
  schema: MetadataFieldSchema,
  cond: FilterCondition,
  path: string,
  errors: ValidationError[],
): void {
  const v = cond.value;

  switch (schema.type) {
    case 'number': {
      if (cond.op === 'between') {
        if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'number' || typeof v[1] !== 'number') {
          errors.push({ path, message: `between requires [min, max] number tuple` });
        }
      } else if (cond.op === 'in') {
        if (!Array.isArray(v) || !v.every(x => typeof x === 'number')) {
          errors.push({ path, message: `in requires number[]` });
        }
      } else if (typeof v !== 'number') {
        errors.push({ path, message: `Expected number, got ${typeof v}` });
      }
      break;
    }
    case 'boolean': {
      if (typeof v !== 'boolean') {
        errors.push({ path, message: `Expected boolean, got ${typeof v}` });
      }
      break;
    }
    case 'string': {
      if (cond.op === 'in') {
        if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) {
          errors.push({ path, message: `in requires string[]` });
          return;
        }
        // validate enum values
        if (schema.enumValues) {
          for (const item of v) {
            if (!schema.enumValues.includes(item)) {
              errors.push({ path, message: `Invalid enum value "${item}" for "${schema.name}"` });
            }
          }
        }
      } else if (typeof v !== 'string') {
        errors.push({ path, message: `Expected string, got ${typeof v}` });
      } else if (schema.enumValues && (cond.op === 'eq')) {
        if (!schema.enumValues.includes(v)) {
          errors.push({ path, message: `Invalid enum value "${v}" for "${schema.name}"` });
        }
      }
      break;
    }
    case 'string[]': {
      if (cond.op === 'in') {
        if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) {
          errors.push({ path, message: `in requires string[]` });
          return;
        }
        if (schema.enumValues) {
          for (const item of v) {
            if (!schema.enumValues.includes(item)) {
              errors.push({ path, message: `Invalid enum value "${item}" for "${schema.name}"` });
            }
          }
        }
      } else if (cond.op === 'contains') {
        if (typeof v !== 'string') {
          errors.push({ path, message: `contains on string[] expects string element` });
        } else if (schema.enumValues && !schema.enumValues.includes(v)) {
          errors.push({ path, message: `Invalid enum value "${v}" for "${schema.name}"` });
        }
      } else if (cond.op === 'eq') {
        if (typeof v !== 'string') {
          errors.push({ path, message: `eq on string[] expects string` });
        }
      }
      break;
    }
  }
}

// ── Fallback derivation ──

/**
 * From a validated AST, derive a single fallback AST.
 *
 * Rules (in order):
 * 1. Keep ALL hard conditions from the original AST.
 * 2. If no hard conditions exist, keep soft conditions in order of
 *    `fallbackPriority` (lowest = highest priority), up to 3 conditions.
 * 3. Always return a flat `and` node, or null if nothing to keep.
 */
export function deriveFallbackAst(ast: FilterAst): FilterAst {
  if (!ast) return null;
  const conditions = collectConditions(ast);

  const hardFields = new Set(getHardFieldNames());
  const hardConds = conditions.filter(c => hardFields.has(c.field));

  if (hardConds.length > 0) {
    return hardConds.length === 1 ? hardConds[0] : { type: 'and', children: hardConds };
  }

  // No hard conditions — keep top-priority soft conditions
  const softConds = conditions
    .filter(c => !hardFields.has(c.field))
    .map(c => {
      const s = getFieldSchema(c.field);
      return { cond: c, priority: s?.fallbackPriority ?? 99 };
    })
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3)
    .map(x => x.cond);

  if (softConds.length === 0) return null;
  return softConds.length === 1 ? softConds[0] : { type: 'and', children: softConds };
}

/** Flatten a tree into a flat list of FilterCondition leaves. */
export function collectConditions(node: FilterNode): FilterCondition[] {
  if (isFilterCondition(node)) return [node];
  if (node.type === 'and' || node.type === 'or') {
    return node.children.flatMap(collectConditions);
  }
  if (node.type === 'not') {
    return collectConditions(node.child);
  }
  return [];
}
