/**
 * Admin Text2SQL Agent — orchestrator.
 *
 * Pipeline: Retriever → Generator → Validator → Executor
 *            Error reflection retry (max 2) on validation or execution failure.
 */

import { retrieveKnowledge } from './retriever';
import { generateSQL } from './generator';
import { executeSQL } from './executor';
import { validateAdminSQL, validateQuestion } from './validator';
import { inferVisualization, type VisualizationSpec } from './visualization';

const MAX_ROWS = Number(process.env.TEXT2SQL_MAX_ROWS) || 100;
const MAX_RETRIES = Number(process.env.TEXT2SQL_MAX_RETRIES) || 2;

export interface Text2SQLRequest {
  question: string;
  dryRun?: boolean;
  maxRows?: number;
}

export interface Text2SQLResponse {
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  attempts: number;
  executionMs: number;
  warnings: string[];
  knowledgeSources: string[];
  visualization?: VisualizationSpec | null;
}

export async function runText2SQL(req: Text2SQLRequest): Promise<Text2SQLResponse> {
  const qCheck = validateQuestion(req.question);
  if (!qCheck.valid) {
    throw Object.assign(new Error(qCheck.error), { attempts: 0, warnings: [] });
  }

  const effectiveMaxRows = Math.min(req.maxRows ?? MAX_ROWS, MAX_ROWS);
  const warnings: string[] = [];
  const startTime = Date.now();

  // ── Retrieve ──
  const knowledge = await retrieveKnowledge(req.question);
  const knowledgeSources: string[] = [];
  if (knowledge.ddl) knowledgeSources.push('retrieved:sql_ddl');
  if (knowledge.descriptions) knowledgeSources.push('retrieved:sql_description');
  if (knowledge.examples) knowledgeSources.push('retrieved:sql_example');

  // ── Generate + Validate loop ──
  let sql = '';
  let attempt = 0;
  let lastError = '';

  while (attempt < MAX_RETRIES + 1) {
    attempt++;
    try {
      sql = await generateSQL(
        req.question, knowledge,
        lastError ? `Error: ${lastError}\nOriginal SQL: ${sql}` : undefined,
      );
    } catch (err: any) {
      lastError = `LLM call failed: ${err.message}`;
      if (attempt <= MAX_RETRIES) continue;
      throw Object.assign(new Error(`Text2SQL failed after ${attempt} attempts`), {
        detail: err.message, sql, attempts: attempt, warnings,
      });
    }

    const validation = validateAdminSQL(sql, effectiveMaxRows);
    if (!validation.valid) {
      lastError = `Validation failed: ${validation.error}`;
      if (attempt <= MAX_RETRIES) continue;
      throw Object.assign(new Error(`Validation failed after ${attempt} attempts`), {
        detail: validation.error, sql, attempts: attempt, warnings,
      });
    }
    sql = validation.sql;
    break;
  }

  // ── Dry run ──
  if (req.dryRun) {
    return { sql, columns: [], rows: [], rowCount: 0, attempts: attempt,
      executionMs: Date.now() - startTime, warnings: [...warnings, 'dryRun=true'], knowledgeSources,
      visualization: null };
  }

  // ── Execute with retry ──
  for (let execAttempt = 0; execAttempt <= MAX_RETRIES; execAttempt++) {
    try {
      const { columns, rows, ms } = await executeSQL(sql, effectiveMaxRows);
      const visualization = inferVisualization(columns, rows, req.question);
      return { sql, columns, rows, rowCount: rows.length, attempts: attempt,
        executionMs: ms, warnings, knowledgeSources, visualization };
    } catch (err: any) {
      const msg = err.message || String(err);
      warnings.push(`Exec attempt ${execAttempt + 1} failed: ${msg}`);
      if (execAttempt < MAX_RETRIES) {
        try {
          sql = await generateSQL(req.question, knowledge,
            `Execution error: ${msg}\nOriginal SQL: ${sql}`);
          const v = validateAdminSQL(sql, effectiveMaxRows);
          if (!v.valid) { warnings.push(`Re-validation failed: ${v.error}`); continue; }
          sql = v.sql; attempt++;
        } catch (genErr: any) { warnings.push(`Fix failed: ${genErr.message}`); continue; }
      } else {
        throw Object.assign(new Error('Execution exhausted retries'), {
          detail: msg, sql, attempts: attempt, warnings,
        });
      }
    }
  }

  throw Object.assign(new Error('Text2SQL exhausted all retries'), { sql, attempts: attempt, warnings });
}
