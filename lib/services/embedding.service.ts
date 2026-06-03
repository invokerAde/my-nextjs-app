import OpenAI from 'openai';
import { fetch as undiciFetch, Agent } from 'undici';

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

  const opts: Record<string, unknown> = {
    apiKey: process.env.EMBEDDING_API_KEY,
    baseURL: process.env.EMBEDDING_BASE_URL,
    maxRetries: 2,
    timeout: Number(process.env.EMBEDDING_TIMEOUT_MS) || 15000,
  };

  // 阿里云内部端点 SSL 证书可能无法通过公网校验，通过 undici Agent 跳过
  if (process.env.EMBEDDING_TLS_REJECT_UNAUTHORIZED === '0') {
    const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    opts.fetch = undiciFetch;
    (opts as any).fetchOptions = { dispatcher };
  }

  return new OpenAI(opts as any);
}

function buildEmbeddingRequest(input: string | string[]) {
  const params: Record<string, unknown> = {
    model: process.env.EMBEDDING_MODEL!,
    input,
  };
  const dimensions = process.env.EMBEDDING_DIMENSIONS;
  if (dimensions) {
    params.dimensions = parseInt(dimensions, 10);
  }
  return params;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Input text must be a non-empty string');
  }

  try {
    const params = buildEmbeddingRequest(text.replace(/\n/g, ' '));
    const response = await getClient().embeddings.create(params as any);

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
    const params = buildEmbeddingRequest(texts.map(t => t.replace(/\n/g, ' ')));
    const response = await getClient().embeddings.create(params as any);

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
