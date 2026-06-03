import { generateEmbedding, generateEmbeddings } from '@/lib/services/embedding.service';
import OpenAI from 'openai';

jest.mock('openai');

describe('Embedding service', () => {
  const mockCreate = jest.fn();
  const mockEmbeddings = { create: mockCreate };

  beforeEach(() => {
    jest.clearAllMocks();
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      embeddings: mockEmbeddings,
    }));
  });

  describe('generateEmbedding', () => {
    it('calls OpenAI with normalized input and returns embedding', async () => {
      mockCreate.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      });

      const result = await generateEmbedding('hello\nworld');

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'hello world',
      });
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it('throws on empty input', async () => {
      await expect(generateEmbedding('')).rejects.toThrow('Input text must be a non-empty string');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('throws on whitespace-only input', async () => {
      await expect(generateEmbedding('   ')).rejects.toThrow('Input text must be a non-empty string');
    });
  });

  describe('generateEmbeddings', () => {
    it('calls OpenAI with normalized inputs and returns embeddings', async () => {
      mockCreate.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
      });

      const result = await generateEmbeddings(['hello\nworld', 'foo\nbar']);

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['hello world', 'foo bar'],
      });
      expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    });

    it('throws on empty array', async () => {
      await expect(generateEmbeddings([])).rejects.toThrow('Input texts must be a non-empty array');
    });

    it('throws on array with empty string', async () => {
      await expect(generateEmbeddings(['valid', ''])).rejects.toThrow(
        'Each text must be a non-empty string',
      );
    });
  });
});
