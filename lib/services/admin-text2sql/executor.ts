/**
 * SQL Executor — readonly connection with database-level statement_timeout.
 */

const EXEC_TIMEOUT_MS = Number(process.env.TEXT2SQL_EXEC_TIMEOUT_MS) || 60000;

let readonlyPrisma: any = null;

async function getReadonlyPrisma(): Promise<any> {
  if (readonlyPrisma) return readonlyPrisma;

  const readonlyUrl = process.env.TEXT2SQL_DATABASE_URL || process.env.DATABASE_URL;
  if (!readonlyUrl) throw new Error('DATABASE_URL not configured');

  try {
    const { PrismaClient } = await import('@/prisma/generated/prisma/client');
    const { PrismaNeon } = await import('@prisma/adapter-neon');
    readonlyPrisma = new PrismaClient({
      adapter: new PrismaNeon({ connectionString: readonlyUrl }),
    });
  } catch {
    const { prisma } = await import('@/lib/rag/db');
    readonlyPrisma = prisma;
  }
  return readonlyPrisma;
}

export async function executeSQL(
  sql: string,
  maxRows: number,
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; ms: number }> {
  const start = Date.now();
  const client = await getReadonlyPrisma();

  const timeoutMs = Math.max(EXEC_TIMEOUT_MS, 1000);

  // Wrap in a transaction so SET LOCAL does not leak to pooled connections.
  const result = await client.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${timeoutMs}`);
    await tx.$executeRawUnsafe('SET LOCAL default_transaction_read_only = on');
    const rows = await tx.$queryRawUnsafe(sql) as Record<string, unknown>[];
    return rows;
  });

  return {
    columns: result.length > 0 ? Object.keys(result[0]) : [],
    rows: result.slice(0, maxRows),
    ms: Date.now() - start,
  };
}
