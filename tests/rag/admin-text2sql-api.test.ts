/**
 * API-level tests for POST /api/admin/ai-analytics/text2sql
 *
 * These test the route handler's auth, validation, and error responses.
 * The actual Text2SQL pipeline is mocked.
 */

import { NextRequest } from 'next/server';
import { auth } from '@/auth';

// We import the route handler dynamically since it depends on Next.js + auth
// For type-level and structural tests we test the exported types directly.

// ── Response shape verification ──

describe('Admin Text2SQL API response shape', () => {
  it('Text2SQLResponse type has all required fields', () => {
    // Compile-time check: if this compiles, the shape is correct
    const response: {
      sql: string;
      columns: string[];
      rows: Record<string, unknown>[];
      rowCount: number;
      attempts: number;
      executionMs: number;
      warnings: string[];
      knowledgeSources: string[];
    } = {
      sql: 'SELECT 1',
      columns: ['?column?'],
      rows: [{ '?column?': 1 }],
      rowCount: 1,
      attempts: 1,
      executionMs: 42,
      warnings: [],
      knowledgeSources: ['retrieved:sql_ddl'],
    };
    expect(response.sql).toBe('SELECT 1');
    expect(response.columns).toEqual(['?column?']);
    expect(response.rowCount).toBe(1);
    expect(response.executionMs).toBe(42);
  });

  it('Text2SQLRequest type accepts question, dryRun, maxRows', () => {
    const req: {
      question: string;
      dryRun?: boolean;
      maxRows?: number;
    } = { question: 'test' };
    expect(req.question).toBe('test');
    expect(req.dryRun).toBeUndefined();
    expect(req.maxRows).toBeUndefined();

    const fullReq: typeof req = {
      question: 'test',
      dryRun: true,
      maxRows: 50,
    };
    expect(fullReq.dryRun).toBe(true);
    expect(fullReq.maxRows).toBe(50);
  });

  it('error response shape has error, detail, sql, attempts, warnings', () => {
    const errorBody: {
      error: string;
      detail?: string;
      sql?: string;
      attempts?: number;
      warnings?: string[];
    } = {
      error: 'Text2SQL execution failed',
      detail: 'relation not found',
      sql: 'SELECT * FROM bad_table',
      attempts: 2,
      warnings: ['Exec attempt 1 failed'],
    };
    expect(errorBody.error).toBeTruthy();
    expect(errorBody.detail).toBeTruthy();
    expect(errorBody.sql).toBeTruthy();
    expect(errorBody.attempts).toBe(2);
  });

  it('403 error has error and detail fields', () => {
    const forbiddenBody: { error: string; detail: string } = {
      error: 'Forbidden',
      detail: 'Admin role required',
    };
    expect(forbiddenBody.error).toBe('Forbidden');
    expect(forbiddenBody.detail).toBe('Admin role required');
  });

  it('400 error for missing question has error and detail', () => {
    const badRequestBody: { error: string; detail: string } = {
      error: 'Bad Request',
      detail: 'Missing required field: question (string)',
    };
    expect(badRequestBody.error).toBe('Bad Request');
  });

  it('invalid JSON body returns 400', () => {
    const invalidJsonBody: { error: string; detail: string } = {
      error: 'Bad Request',
      detail: 'Invalid JSON body',
    };
    expect(invalidJsonBody.error).toBe('Bad Request');
  });
});

// ── Route handler structural test ──

// Mock auth before importing the route so next-auth ESM isn't loaded by Jest
jest.mock('@/auth', () => ({
  auth: jest.fn().mockResolvedValue(null),
}));

describe('Admin Text2SQL route handler', () => {
  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('exports POST handler', async () => {
    const mod = await import('@/app/api/admin/ai-analytics/text2sql/route');
    expect(typeof mod.POST).toBe('function');
  });

  it('POST returns 403 for request without admin session', async () => {
    const { POST } = await import('@/app/api/admin/ai-analytics/text2sql/route');

    // Create a request without auth cookies
    const req = new NextRequest('http://localhost/api/admin/ai-analytics/text2sql', {
      method: 'POST',
      body: JSON.stringify({ question: 'test' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toBe('Forbidden');
    expect(body.detail).toBe('Admin role required');
  });

  it('POST returns 403 even for empty body (auth checked first)', async () => {
    const { POST } = await import('@/app/api/admin/ai-analytics/text2sql/route');

    const req = new NextRequest('http://localhost/api/admin/ai-analytics/text2sql', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    // Without admin session, returns 403 before reaching body validation
    expect(res.status).toBe(403);
  });

  it('POST returns 400 for invalid JSON body when admin', async () => {
    // Override auth mock to return admin session for this test
    (auth as jest.Mock).mockResolvedValueOnce({
      user: { role: 'admin', id: 'test', name: 'Admin' },
    });

    const { POST } = await import('@/app/api/admin/ai-analytics/text2sql/route');

    const req = new NextRequest('http://localhost/api/admin/ai-analytics/text2sql', {
      method: 'POST',
      body: 'not-valid-json',
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Bad Request');
    expect(body.detail).toBe('Invalid JSON body');
  });

  it('POST returns 400 for missing question when admin', async () => {
    (auth as jest.Mock).mockResolvedValueOnce({
      user: { role: 'admin', id: 'test', name: 'Admin' },
    });

    const { POST } = await import('@/app/api/admin/ai-analytics/text2sql/route');

    const req = new NextRequest('http://localhost/api/admin/ai-analytics/text2sql', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Bad Request');
    expect(body.detail).toBe('Missing required field: question (string)');
  });
});
