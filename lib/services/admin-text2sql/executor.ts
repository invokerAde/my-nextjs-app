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

  // Database-level statement_timeout (milliseconds)
  const timeoutMs = Math.max(EXEC_TIMEOUT_MS, 1000);
  await client.$executeRawUnsafe(`SET statement_timeout = ${timeoutMs}`);

  // Set session to read-only — failure is fatal here
  await client.$executeRawUnsafe('SET default_transaction_read_only = on');

  const result = await client.$queryRawUnsafe(sql) as Record<string, unknown>[];

  return {
    columns: result.length > 0 ? Object.keys(result[0]) : [],
    rows: result.slice(0, maxRows),
    ms: Date.now() - start,
  };
}
