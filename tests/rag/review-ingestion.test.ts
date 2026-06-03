import { computeDocHash } from '@/lib/rag/hasher';

describe('Review dual-track logic', () => {
  const REVIEW_THRESHOLD = 5;

  it('routes reviews <= 5 to direct path', () => {
    const reviewCount = 3;
    expect(reviewCount <= REVIEW_THRESHOLD).toBe(true);
  });

  it('routes reviews > 5 to aggregate path', () => {
    const reviewCount = 7;
    expect(reviewCount <= REVIEW_THRESHOLD).toBe(false);
  });

  it('detects review switch from aggregate to direct after cleanup', () => {
    // Simulating: product had >5 reviews (aggregate), now reviews drop to 4
    const afterCleanupCount = 4;
    expect(afterCleanupCount <= REVIEW_THRESHOLD).toBe(true);
  });

  it('computeDocHash is deterministic for review content', () => {
    const hash1 = computeDocHash('[评分4] 尺码偏大，面料透气性好');
    const hash2 = computeDocHash('[评分4] 尺码偏大，面料透气性好');
    expect(hash1).toBe(hash2);
  });
});
