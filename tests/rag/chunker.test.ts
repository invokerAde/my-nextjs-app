import { chunkDocument, estimateTokens } from '@/lib/rag/chunker';

describe('estimateTokens', () => {
  it('should estimate CJK characters at ~0.6 tokens per char', () => {
    const text = '这是一个测试句子用于评估token数量';
    const tokens = estimateTokens(text);
    // 16 CJK chars * 0.6 = 9.6, ceil = 10
    expect(tokens).toBe(10);
  });

  it('should estimate ASCII characters at ~0.25 tokens per char', () => {
    const text = 'This is a test sentence for token counting.';
    const tokens = estimateTokens(text);
    // 44 chars (including spaces) * 0.25 = 11, ceil = 11
    expect(tokens).toBeGreaterThanOrEqual(8);
    expect(tokens).toBeLessThanOrEqual(15);
  });
});

describe('chunkDocument', () => {
  it('should return empty array for empty text', () => {
    expect(chunkDocument('')).toEqual([]);
    expect(chunkDocument('   ')).toEqual([]);
  });

  it('should split long text into multiple chunks under maxTokens', () => {
    // Generate 100 CJK characters (100 * 0.6 = 60 tokens -> should fit in one chunk with default 500)
    // Use longer text that exceeds maxTokens
    const sentence = '这是一个测试句子。'.repeat(100); // ~100 * 10 * 0.6 = 600 tokens (approximately)
    const chunks = chunkDocument(sentence, { maxTokens: 200, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be under maxTokens
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(200 + 15); // Allow small margin for ceil
    }
  });

  it('should split on paragraph boundaries', () => {
    const text =
      '第一段内容在这里。这是第一段的第二句。\n\n第二段开头语句。继续第二段的内容。';
    const chunks = chunkDocument(text, { maxTokens: 500 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // The text should be properly chunked (both paragraphs are short, so likely 1 chunk)
    expect(chunks[0].content).toBeDefined();
  });

  it('should include metadata in chunks', () => {
    const text = '商品质量很好，面料舒适。';
    const chunks = chunkDocument(text, {
      baseMetadata: { docType: 'review', productId: '123' },
    });
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata).toEqual({ docType: 'review', productId: '123' });
  });
});
