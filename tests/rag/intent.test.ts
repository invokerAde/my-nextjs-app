import { classifyIntent } from '@/lib/services/intent.service';

describe('classifyIntent', () => {
  it('routes price query to realtime_price_stock', () => {
    expect(classifyIntent('这件衣服多少钱？').intents).toContain('realtime_price_stock');
  });

  it('routes stock query to realtime_price_stock', () => {
    expect(classifyIntent('这款还有M码吗？').intents).toContain('realtime_price_stock');
  });

  it('routes recommendation to product_filter', () => {
    expect(classifyIntent('100元以内棉质长袖有什么推荐？').intents).toContain('product_filter');
  });

  it('routes review question to review_insight', () => {
    expect(classifyIntent('用户说这款尺码偏大还是偏小？').intents).toContain('review_insight');
  });

  it('routes faq to policy_faq', () => {
    expect(classifyIntent('7天退货政策是什么？').intents).toContain('policy_faq');
  });

  it('marks promotion query as time-sensitive', () => {
    const result = classifyIntent('现在有什么优惠活动？');
    expect(result.intents).toContain('realtime_price_stock');
    expect(result.isTimeSensitive).toBe(true);
  });

  it('returns multiple intents for cross-category queries', () => {
    const result = classifyIntent('评价好的棉质衬衫推荐');
    expect(result.intents).toContain('product_filter');
    expect(result.intents).toContain('review_insight');
  });

  it('returns multiple intents for filter + detail queries', () => {
    const result = classifyIntent('透气性好的短袖，偏大还是偏小');
    expect(result.intents).toContain('product_filter');
    expect(result.intents).toContain('review_insight');
  });

  it('returns hybrid when no keywords match', () => {
    const result = classifyIntent('你好');
    expect(result.intents).toEqual(['hybrid']);
  });
});
