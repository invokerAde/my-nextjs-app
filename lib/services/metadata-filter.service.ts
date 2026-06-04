/**
 * @deprecated This module is kept for backward compatibility.
 *
 * The main retrieval pipeline now uses:
 *   - text-to-metadata-filter.service.ts  (LLM → AST)
 *   - filter-translator.service.ts        (AST → parameterized SQL)
 *   - metadata-schema.ts                  (single source of truth)
 *
 * These re-exports delegate to the new modules or provide thin wrappers.
 * Do NOT add new logic here — extend the new modules instead.
 */

import { getFieldSchema, METADATA_SCHEMA } from '@/lib/rag/metadata-schema';
import { type FilterAst, validateAst, type FilterNode } from '@/lib/rag/filter-ast';
import { translateAst } from '@/lib/services/filter-translator.service';

// Re-export new types for callers that haven't migrated yet
export type { FilterAst, FilterNode } from '@/lib/rag/filter-ast';
export type { TranslationResult } from '@/lib/services/filter-translator.service';
export { translateAst } from '@/lib/services/filter-translator.service';
export { validateAst } from '@/lib/rag/filter-ast';

/**
 * @deprecated Use getFieldSchema() from metadata-schema.ts instead.
 */
export function safeAttributeKey(key: string): string | undefined {
  const s = getFieldSchema(key);
  return s?.name;
}
