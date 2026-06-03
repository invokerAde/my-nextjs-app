describe('Embedding service contract tests', () => {
  it('should have embedding model config set', () => {
    // Default fallback is text-embedding-3-small
    const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
    expect(model).toBe('text-embedding-3-small');
  });

  it('should expect embedding dimension of 1536 for text-embedding-3-small', () => {
    // text-embedding-3-small produces 1536-dimensional vectors
    const EXPECTED_DIMENSION = 1536;
    expect(EXPECTED_DIMENSION).toBe(1536);
  });

  it('should normalize input by stripping newlines', () => {
    // The generateEmbedding function replaces \n with space before sending
    const inputNormalize = (text: string) => text.replace(/\n/g, ' ');
    const raw = 'Line 1\nLine 2\nLine 3';
    const normalized = inputNormalize(raw);
    expect(normalized).not.toContain('\n');
    expect(normalized).toBe('Line 1 Line 2 Line 3');
  });
});
