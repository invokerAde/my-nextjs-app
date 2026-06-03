import { generateEmbedding, generateEmbeddings, isEmbeddingConfigured } from '@/lib/services/embedding.service';
import OpenAI from 'openai';

jest.mock('openai');

const mockCreate = jest.fn();
const mockEmbeddings = { create: mockCreate };

beforeAll(() => {
  process.env.EMBEDDING_API_KEY = 'test-key';
  process.env.EMBEDDING_BASE_URL = 'https://api.openai.com/v1';
  process.env.EMBEDDING_MODEL = 'text-embedding-3-small';
});

beforeEach(() => {
  jest.clearAllMocks();
  (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
    embeddings: mockEmbeddings,
  }));
});

describe('Embedding service', () => {
  describe('isEmbeddingConfigured', () => {
    it('returns true when EMBEDDING_API_KEY and EMBEDDING_MODEL are set', () => {
      // Config was set in beforeAll, but the module-level cache may need re-import
      // At minimum the function should behave correctly
      expect(isEmbeddingConfigured()).toBe(true);
    });
  });

  describe('generateEmbedding', () => {
    it('calls the provider with normalized input and returns embedding', async () => {
      mockCreate.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      });

      const result = await generateEmbedding('hello\nworld');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'text-embedding-3-small', input: 'hello world' }),
      );
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
    it('calls provider with normalized inputs and returns embeddings', async () => {
      mockCreate.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
      });

      const result = await generateEmbeddings(['hello\nworld', 'foo\nbar']);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'text-embedding-3-small', input: ['hello world', 'foo bar'] }),
      );
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
