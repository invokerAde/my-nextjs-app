import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { runText2SQL } from '@/lib/services/admin-text2sql/agent';

export const maxDuration = 60;

export async function POST(req: Request) {
  // ── Auth: admin only ──
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden', detail: 'Admin role required' },
      { status: 403 },
    );
  }

  // ── Parse request ──
  let body: { question?: string; dryRun?: boolean; maxRows?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Bad Request', detail: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  if (!body.question || typeof body.question !== 'string') {
    return NextResponse.json(
      { error: 'Bad Request', detail: 'Missing required field: question (string)' },
      { status: 400 },
    );
  }

  // ── Run Text2SQL agent ──
  try {
    const result = await runText2SQL({
      question: body.question,
      dryRun: body.dryRun === true,
      maxRows: body.maxRows,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[admin-text2sql] Error:', err.message || err);
    return NextResponse.json(
      {
        error: 'Text2SQL execution failed',
        detail: err.detail || err.message || 'Unknown error',
        sql: err.sql || undefined,
        attempts: err.attempts || 0,
        warnings: err.warnings || [],
      },
      { status: 500 },
    );
  }
}
