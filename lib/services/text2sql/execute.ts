/**
 * SQL execution with Prisma — requires database connection.
 * Import only in server/API contexts, not in Jest tests.
 */

export async function executeSQL(sql: string): Promise<Record<string, unknown>[]> {
  // Dynamic import to avoid Prisma ESM issues in test environments
  const { prisma } = await import('@/lib/rag/db');
  return prisma.$queryRawUnsafe(sql) as Promise<Record<string, unknown>[]>;
}
