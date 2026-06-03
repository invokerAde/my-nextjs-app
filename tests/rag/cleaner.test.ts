import { cleanReviewText } from '@/lib/rag/cleaner';

describe('cleanReviewText', () => {
  it('should return null for empty or very short text', () => {
    expect(cleanReviewText('')).toBeNull();
    expect(cleanReviewText('ab')).toBeNull();
    expect(cleanReviewText('   ')).toBeNull();
  });

  it('should return null for pure symbols', () => {
    expect(cleanReviewText('!!!???')).toBeNull();
    expect(cleanReviewText('...')).toBeNull();
    expect(cleanReviewText('！！！')).toBeNull();
  });

  it('should return null for pure emoji text', () => {
    expect(cleanReviewText('😍😍😍')).toBeNull();
    expect(cleanReviewText('👍👍')).toBeNull();
  });

  it('should split by sentence separators and filter noise', () => {
    const text =
      '快递很快！面料很舒服，做工也很精细。颜色和图片一样好看。客服态度很好，下次还会再来。';
    const result = cleanReviewText(text);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThanOrEqual(2);
    // Logistics noise should be filtered out
    const joined = result!.join(' ');
    expect(joined).not.toContain('快递');
    expect(joined).not.toContain('客服');
    // Signal sentences should be kept
    expect(joined).toContain('面料');
    expect(joined).toContain('做工');
    expect(joined).toContain('颜色');
  });

  it('should keep signal-rich sentences and discard noise-dominated ones', () => {
    const text = '尺码偏大退货了。版型很好，做工不错。物流很快。';
    const result = cleanReviewText(text);
    expect(result).not.toBeNull();
    // "尺码偏大退货了" - has "尺码" (signal) but also "退货" (noise)
    // "版型很好，做工不错" - multiple signals
    // "物流很快" - pure noise
    expect(result!.some((s) => s.includes('版型'))).toBe(true);
    expect(result!.some((s) => s.includes('做工'))).toBe(true);
    expect(result!.some((s) => s.includes('物流'))).toBe(false);
  });

  it('should return null when all sentences are noise', () => {
    const text = '快递很快。客服态度好。下次再来。';
    const result = cleanReviewText(text);
    expect(result).toBeNull();
  });
});
