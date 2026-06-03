/**
 * Document chunker for AI Shopping Assistant RAG system.
 *
 * Splits documents into overlapping chunks suitable for embedding and retrieval.
 * Uses a simple token estimator (CJK ≈ 0.6 tokens/char, ASCII ≈ 0.25 tokens/char).
 */

export interface Chunk {
  index: number;
  content: string;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

export interface ChunkerOptions {
  /** Maximum tokens per chunk (default 500) */
  maxTokens?: number;
  /** Overlap tokens between consecutive chunks (default 50) */
  overlapTokens?: number;
  /** Additional metadata to attach to every chunk */
  baseMetadata?: Record<string, unknown>;
}

// CJK unified ideographs ranges (simplified and traditional Chinese, Japanese, Korean)
const CJK_RE = /[一-鿿㐀-䶿豈-﫿]|[぀-ゟ゠-ヿ가-힯]/;

/**
 * Estimate the number of tokens for a string.
 * CJK characters ≈ 0.6 tokens each; other characters ≈ 0.25 tokens each.
 */
export function estimateTokens(text: string): number {
  let cjkCount = 0;
  let otherCount = 0;

  for (let i = 0; i < text.length; i++) {
    if (CJK_RE.test(text[i])) {
      cjkCount++;
    } else {
      otherCount++;
    }
  }

  return Math.ceil(cjkCount * 0.6 + otherCount * 0.25);
}

/**
 * Split text into sentences using common sentence terminators.
 */
function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  // Split on sentence boundaries, keeping the delimiter
  const parts = text.split(/([。！？.!?\n]+)/);

  for (let i = 0; i < parts.length; i += 2) {
    const content = parts[i]?.trim();
    const delimiter = parts[i + 1] || '';
    if (content) {
      sentences.push(content + delimiter);
    }
  }

  return sentences.length > 0 ? sentences : [text];
}

/**
 * Chunk a document into overlapping segments.
 *
 * @param text - Document text to chunk
 * @param options - Chunking configuration
 * @returns Array of chunks
 */
export function chunkDocument(text: string, options: ChunkerOptions = {}): Chunk[] {
  const {
    maxTokens = 500,
    overlapTokens = 50,
    baseMetadata = {},
  } = options;

  if (!text || text.trim().length === 0) return [];

  // Step 1: Split on paragraph boundaries
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);

  // Step 2: Split each paragraph into sentences
  const sentences: string[] = [];
  for (const para of paragraphs) {
    sentences.push(...splitSentences(para));
  }

  if (sentences.length === 0) return [];

  // Step 3: Build chunks with overlap
  const chunks: Chunk[] = [];
  let chunkIndex = 0;
  let i = 0;

  while (i < sentences.length) {
    const chunkSentences: string[] = [];
    let currentTokens = 0;

    // Add sentences until approaching maxTokens
    while (i < sentences.length) {
      const sentenceTokens = estimateTokens(sentences[i]);
      if (currentTokens + sentenceTokens > maxTokens && chunkSentences.length > 0) {
        // This sentence would exceed maxTokens; start a new chunk
        break;
      }
      chunkSentences.push(sentences[i]);
      currentTokens += sentenceTokens;
      i++;
    }

    const content = chunkSentences.join(' ').trim();
    if (content.length === 0) break;

    chunks.push({
      index: chunkIndex,
      content,
      tokenCount: estimateTokens(content),
      metadata: { ...baseMetadata },
    });

    chunkIndex++;

    // Handle overlap: backtrack overlapTokens worth of sentences for the next chunk
    if (i < sentences.length && overlapTokens > 0) {
      let overlapBack = 0;
      let backtrackCount = 0;
      // Backtrack sentences from the end of the current chunk
      for (let j = chunkSentences.length - 1; j >= 0 && overlapBack < overlapTokens; j--) {
        overlapBack += estimateTokens(chunkSentences[j]);
        backtrackCount++;
      }
      // Move the index back for overlap
      if (backtrackCount > 0) {
        i = Math.max(i - backtrackCount, 0);
        // But ensure we don't loop forever on a single sentence
        if (i <= chunkIndex - 1) {
          i = Math.max(i, 0);
        }
        // Safety: ensure forward progress
        if (backtrackCount >= chunkSentences.length && sentences.length > 1) {
          i = Math.min(i + 1, sentences.length);
        }
      }
    }
  }

  return chunks;
}
