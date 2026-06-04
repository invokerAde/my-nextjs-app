/**
 * SQL execution with Prisma — requires database connection.
 * Import only in server/API contexts, not in Jest tests.
 */

const EXEC_TIMEOUT_MS = Number(process.env.TEXT2SQL_EXEC_TIMEOUT_MS) || 3000;

export async function executeSQL(sql: string): Promise<Record<string, unknown>[]> {
  // Dynamic import to avoid Prisma ESM issues in test environments
  const { prisma } = await import('@/lib/rag/db');

  const result = await Promise.race([
    prisma.$queryRawUnsafe(sql) as Promise<Record<string, unknown>[]>,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('SQL execution timeout')), EXEC_TIMEOUT_MS),
    ),
  ]);
  return result;
}
