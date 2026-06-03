import OpenAI from 'openai';

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

function getClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 2,
    timeout: 15000,
  });
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Input text must be a non-empty string');
  }

  try {
    const response = await getClient().embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.replace(/\n/g, ' '),
    });

    if (!response.data?.[0]?.embedding) {
      throw new Error('OpenAI returned empty embedding response');
    }

    return response.data[0].embedding;
  } catch (error: any) {
    if (error.message?.includes('Input text must be')) throw error;
    throw new Error(`Embedding generation failed: ${error.message || 'Unknown error'}`, {
      cause: error,
    });
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
      model: EMBEDDING_MODEL,
      input: texts.map(t => t.replace(/\n/g, ' ')),
    });

    const embeddings = response.data.map(d => d.embedding);

    if (embeddings.length !== texts.length) {
      throw new Error(
        `Expected ${texts.length} embeddings but got ${embeddings.length}`,
      );
    }

    return embeddings;
  } catch (error: any) {
    if (error.message?.includes('Input texts must be')) throw error;
    throw new Error(`Batch embedding generation failed: ${error.message || 'Unknown error'}`, {
      cause: error,
    });
  }
}
