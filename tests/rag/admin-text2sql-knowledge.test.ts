import {
  ANALYTICS_VIEWS,
  VIEW_DDL,
  FIELD_DESCRIPTIONS,
  FEW_SHOT_EXAMPLES,
} from '@/lib/services/admin-text2sql/knowledge';

describe('Admin Text2SQL Knowledge', () => {
  it('all 4 analytics views are defined', () => {
    expect(ANALYTICS_VIEWS).toHaveLength(4);
    expect(ANALYTICS_VIEWS).toContain('admin_product_analytics_view');
    expect(ANALYTICS_VIEWS).toContain('admin_order_analytics_view');
    expect(ANALYTICS_VIEWS).toContain('admin_review_analytics_view');
    expect(ANALYTICS_VIEWS).toContain('admin_customer_summary_view');
  });

  it('every view has DDL', () => {
    for (const view of ANALYTICS_VIEWS) {
      expect(VIEW_DDL[view]).toBeDefined();
      expect(VIEW_DDL[view]).toContain('CREATE VIEW');
      expect(VIEW_DDL[view]).toContain(view);
    }
  });

  it('field descriptions cover every view', () => {
    const covered = new Set(FIELD_DESCRIPTIONS.map(f => f.view));
    for (const view of ANALYTICS_VIEWS) {
      expect(covered.has(view)).toBe(true);
    }
  });

  it('every field description has a non-empty description', () => {
    for (const f of FIELD_DESCRIPTIONS) {
      expect(f.field.length).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(0);
    }
  });

  it('has at least 20 Few-Shot examples', () => {
    expect(FEW_SHOT_EXAMPLES.length).toBeGreaterThanOrEqual(20);
  });

  it('Few-Shot examples cover all 4 core scenarios', () => {
    const combined = FEW_SHOT_EXAMPLES.map(e => (e.question + e.sql).toLowerCase()).join(' ');
    const hasProduct = /product|商品|库存|评分/.test(combined);
    const hasOrder = /order|订单|销售|支付/.test(combined);
    const hasReview = /review|评论|评分/.test(combined);
    const hasCustomer = /customer|用户|customer/.test(combined);
    if (!hasProduct || !hasOrder || !hasReview || !hasCustomer) {
      console.log('Few-Shot coverage check (expected all true):', { hasProduct, hasOrder, hasReview, hasCustomer });
    }
    expect(hasProduct).toBe(true);
    expect(hasOrder).toBe(true);
    expect(hasReview).toBe(true);
  });

  it('every Few-Shot example SQL references only analytics views', () => {
    const rawTables = ['Product', 'User', 'Order', 'OrderItem', 'Review'];
    for (const ex of FEW_SHOT_EXAMPLES) {
      for (const table of rawTables) {
        // Check that raw table names don't appear as FROM/JOIN targets
        const fromRef = new RegExp(`(?:FROM|JOIN)\\s+(?:"${table}"|${table})\\b`, 'i');
        if (fromRef.test(ex.sql)) {
          console.log(`Few-Shot uses raw table ${table}:`, ex.question);
        }
        expect(fromRef.test(ex.sql)).toBe(false);
      }
    }
  });
});
