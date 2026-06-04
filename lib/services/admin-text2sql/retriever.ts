/**
 * Knowledge Retriever — semantic search against KnowledgeDocument/KnowledgeChunk.
 */

export interface RetrievedKnowledge {
  ddl: string;
  descriptions: string;
  examples: string;
}

const TOP_K: Record<string, number> = { sql_ddl: 4, sql_description: 4, sql_example: 6 };

export async function retrieveKnowledge(question: string): Promise<RetrievedKnowledge> {
  try {
    const { prisma } = await import('@/lib/rag/db');

    let embedding: number[] | null = null;
    try {
      const { generateEmbedding } = await import('@/lib/services/embedding.service');
      embedding = await generateEmbedding(question);
    } catch { /* embedding not configured — fixed-order fallback */ }

    async function retrieve(docType: string, limit: number): Promise<string[]> {
      if (embedding) {
        try {
          const vectorLiteral = `[${embedding.join(',')}]`;
          const rows = await (prisma as any).$queryRawUnsafe(
            `SELECT kc.content, 1 - (kc.embedding <=> $1::vector) AS similarity
             FROM "KnowledgeChunk" kc
             JOIN "KnowledgeDocument" kd ON kd.id = kc."documentId"
             WHERE kc."isActive" = true AND kd."docType" = $2 AND kc.embedding IS NOT NULL
             ORDER BY kc.embedding <=> $1::vector LIMIT $3`,
            vectorLiteral, docType, limit,
          );
          return (rows as any[]).map(r => r.content);
        } catch { /* fall through */ }
      }
      const rows = await (prisma as any).knowledgeChunk.findMany({
        where: { isActive: true, document: { docType } },
        select: { content: true },
        orderBy: { chunkIndex: 'asc' },
        take: limit,
      });
      return (rows as any[]).map(r => r.content);
    }

    const [ddlContents, descContents, exampleContents] = await Promise.all([
      retrieve('sql_ddl', TOP_K.sql_ddl),
      retrieve('sql_description', TOP_K.sql_description),
      retrieve('sql_example', TOP_K.sql_example),
    ]);

    return {
      ddl: ddlContents.join('\n\n') || '(no DDL)',
      descriptions: descContents.join('\n') || '(no descriptions)',
      examples: exampleContents.join('\n\n') || '(no examples)',
    };
  } catch (err: any) {
    console.warn('[retriever] Failed:', err.message);
    return { ddl: '', descriptions: '', examples: '' };
  }
}
