import { computeDocHash } from '@/lib/rag/hasher';

describe('computeDocHash', () => {
  it('should produce the same hash for identical content', () => {
    const content = 'This product is amazing and works perfectly.';
    const hash1 = computeDocHash(content);
    const hash2 = computeDocHash(content);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hash for different content', () => {
    const hash1 = computeDocHash('Content A');
    const hash2 = computeDocHash('Content B');
    expect(hash1).not.toBe(hash2);
  });

  it('should produce different hash when metadata differs', () => {
    const content = 'Same content';
    const hash1 = computeDocHash(content, { version: 1 });
    const hash2 = computeDocHash(content, { version: 2 });
    expect(hash1).not.toBe(hash2);
  });

  it('should produce a 64-character hex string', () => {
    const hash = computeDocHash('test');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});
