import { prisma } from '@/db/prisma';

/**
 * RAG 专用 Prisma 客户端访问。
 * 因为 db/prisma.ts 中的 $extends(Decimal→string) 会窄化 TypeScript 类型，
 * 无法识别新增的 KnowledgeDocument / KnowledgeChunk 等模型（它们没有 Decimal 字段）。
 * 这里做一次类型擦除，保留完整运行时能力。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ragPrisma = prisma as any;

export { ragPrisma as prisma };
