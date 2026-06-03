import OpenAI from 'openai';

/**
 * 检查 embedding provider 是否已配置。
 * 当 EMBEDDING_API_KEY + EMBEDDING_MODEL 都非空时才视为已配置。
 * 每次调用都检查环境变量，不缓存，以支持运行时配置变更和测试。
 */
export function isEmbeddingConfigured(): boolean {
  if (typeof process.env.EMBEDDING_API_KEY !== 'string' || process.env.EMBEDDING_API_KEY.trim().length === 0) return false;
  if (typeof process.env.EMBEDDING_MODEL !== 'string' || process.env.EMBEDDING_MODEL.trim().length === 0) return false;
  return true;
}

function getClient(): OpenAI {
  if (!isEmbeddingConfigured()) {
    throw new Error(
      'Embedding provider not configured. Set EMBEDDING_API_KEY, EMBEDDING_BASE_URL, and EMBEDDING_MODEL in .env',
    );
  }
  return new OpenAI({
    apiKey: process.env.EMBEDDING_API_KEY,
    baseURL: process.env.EMBEDDING_BASE_URL,
    maxRetries: 2,
    timeout: Number(process.env.EMBEDDING_TIMEOUT_MS) || 15000,
  });
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Input text must be a non-empty string');
  }

  try {
    const response = await getClient().embeddings.create({
      model: process.env.EMBEDDING_MODEL!,
      input: text.replace(/\n/g, ' '),
    });

    if (!response.data?.[0]?.embedding) {
      throw new Error('Embedding provider returned empty response');
    }

    return response.data[0].embedding;
  } catch (error: any) {
    if (error.message?.includes('Input text must be')) throw error;
    if (error.message?.includes('not configured')) throw error;
    throw new Error(
      `Embedding generation failed — the configured provider may not support /embeddings: ${error.message || 'Unknown error'}`,
      { cause: error },
    );
  }
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error('Input texts must be a non-empty array');
  }

  for (let i = 0; i < texts.length; i++) {
    if (!texts[i] || typeof texts[i] !== 'string' || texts[i].trim().length === 0) {
      throw new Error(`Each text must be a non-empty string (index ${i} is invalid)`);
    }
  }

  try {
    const response = await getClient().embeddings.create({
      model: process.env.EMBEDDING_MODEL!,
      input: texts.map(t => t.replace(/\n/g, ' ')),
    });

    const embeddings = response.data.map(d => d.embedding);

    if (embeddings.length !== texts.length) {
      throw new Error(`Expected ${texts.length} embeddings but got ${embeddings.length}`);
    }

    return embeddings;
  } catch (error: any) {
    if (error.message?.includes('Input texts must be')) throw error;
    if (error.message?.includes('not configured')) throw error;
    throw new Error(
      `Batch embedding generation failed — the configured provider may not support /embeddings: ${error.message || 'Unknown error'}`,
      { cause: error },
    );
  }
}
