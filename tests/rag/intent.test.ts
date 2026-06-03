import { classifyIntent } from '@/lib/services/intent.service';

describe('classifyIntent', () => {
  it('routes price query to realtime_price_stock', () => {
    expect(classifyIntent('这件衣服多少钱？').intent).toBe('realtime_price_stock');
  });

  it('routes stock query to realtime_price_stock', () => {
    expect(classifyIntent('这款还有M码吗？').intent).toBe('realtime_price_stock');
  });

  it('routes recommendation to product_filter', () => {
    expect(classifyIntent('100元以内棉质长袖有什么推荐？').intent).toBe('product_filter');
  });

  it('routes review question to review_insight', () => {
    expect(classifyIntent('用户说这款尺码偏大还是偏小？').intent).toBe('review_insight');
  });

  it('routes faq to policy_faq', () => {
    expect(classifyIntent('7天退货政策是什么？').intent).toBe('policy_faq');
  });

  it('marks promotion query as time-sensitive', () => {
    const result = classifyIntent('现在有什么优惠活动？');
    expect(result.intent).toBe('realtime_price_stock');
    expect(result.isTimeSensitive).toBe(true);
  });
});
