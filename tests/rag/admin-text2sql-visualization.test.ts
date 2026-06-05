/**
 * Visualization inference tests.
 *
 * Covers: line chart (time series), bar chart (category aggregation),
 * pie chart (distribution/ratio), and negative cases (empty, no numerics,
 * only IDs, too many categories).
 */

import { inferVisualization, VisualizationSpec } from '@/lib/services/admin-text2sql/visualization';

// ── Helpers ──

function vis(result: VisualizationSpec | null) {
  return result;
}

// ── Positive: Line chart (date/time + numeric) ──

describe('inferVisualization: line chart', () => {
  it('detects date column + numeric → line', () => {
    const columns = ['month', 'order_count'];
    const rows = [
      { month: '2025-01', order_count: 42 },
      { month: '2025-02', order_count: 55 },
      { month: '2025-03', order_count: 38 },
    ];
    const result = vis(inferVisualization(columns, rows, 'Monthly orders'));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('line');
    expect(result!.xField).toBe('month');
    expect(result!.yFields).toEqual(['order_count']);
  });

  it('detects created_at timestamp column → line', () => {
    const columns = ['created_at', 'total'];
    const rows = [
      { created_at: '2025-01-15T10:00:00Z', total: 100 },
      { created_at: '2025-02-20T14:30:00Z', total: 200 },
    ];
    const result = vis(inferVisualization(columns, rows, 'Revenue over time'));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('line');
  });

  it('line chart includes multiple yFields', () => {
    const columns = ['date', 'revenue', 'cost', 'profit'];
    const rows = [
      { date: '2025-01-01', revenue: 1000, cost: 600, profit: 400 },
      { date: '2025-01-02', revenue: 1200, cost: 700, profit: 500 },
    ];
    const result = vis(inferVisualization(columns, rows, 'Daily financials'));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('line');
    expect(result!.yFields).toHaveLength(3);
  });
});

// ── Positive: Bar chart (category + numeric) ──

describe('inferVisualization: bar chart', () => {
  it('detects category column + numeric → bar', () => {
    const columns = ['category', 'total_sales'];
    const rows = [
      { category: 'Electronics', total_sales: 15000 },
      { category: 'Clothing', total_sales: 8000 },
      { category: 'Food', total_sales: 12000 },
    ];
    const result = vis(inferVisualization(columns, rows, 'Sales by category'));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('bar');
    expect(result!.xField).toBe('category');
    expect(result!.yFields).toEqual(['total_sales']);
  });

  it('bar chart with multiple numeric columns', () => {
    const columns = ['product', 'views', 'purchases'];
    const rows = [
      { product: 'Widget A', views: 500, purchases: 50 },
      { product: 'Widget B', views: 300, purchases: 30 },
    ];
    const result = vis(inferVisualization(columns, rows, 'Product performance'));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('bar');
    expect(result!.yFields).toHaveLength(2);
  });

  it('bar chart when categories exceed pie limit', () => {
    const columns = ['country', 'revenue'];
    const rows = Array.from({ length: 15 }, (_, i) => ({
      country: `Country_${i}`,
      revenue: 100 + i * 10,
    }));
    const result = vis(inferVisualization(columns, rows, 'Revenue by country'));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('bar');
  });
});

// ── Positive: Pie chart ──

describe('inferVisualization: pie chart', () => {
  it('detects distribution question → pie', () => {
    const columns = ['rating', 'count'];
    const rows = [
      { rating: '5 stars', count: 120 },
      { rating: '4 stars', count: 80 },
      { rating: '3 stars', count: 30 },
    ];
    const result = vis(inferVisualization(columns, rows, 'Rating distribution'));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('pie');
    expect(result!.categoryField).toBe('rating');
    expect(result!.valueField).toBe('count');
  });

  it('detects percentage question → pie', () => {
    const columns = ['status', 'orders'];
    const rows = [
      { status: 'Completed', orders: 200 },
      { status: 'Pending', orders: 50 },
      { status: 'Cancelled', orders: 20 },
    ];
    const result = vis(inferVisualization(columns, rows, 'Order status percentage'));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('pie');
  });

  it('detects breakdown question → pie', () => {
    const columns = ['channel', 'users'];
    const rows = [
      { channel: 'Organic', users: 500 },
      { channel: 'Paid', users: 200 },
    ];
    const result = vis(inferVisualization(columns, rows, 'User breakdown by channel'));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('pie');
  });

  it('pie title is truncated if > 80 chars', () => {
    const columns = ['type', 'amount'];
    const rows = [{ type: 'A', amount: 10 }, { type: 'B', amount: 20 }];
    const longQ = 'What is the distribution of amount values across different types in the system? '.repeat(3);
    const result = vis(inferVisualization(columns, rows, longQ));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('pie');
    expect(result!.title.length).toBeLessThanOrEqual(80);
    expect(result!.title.endsWith('...')).toBe(true);
  });
});

// ── Negative: no visualization ──

describe('inferVisualization: null cases', () => {
  it('returns null for empty rows', () => {
    expect(inferVisualization([], [], 'Empty?')).toBeNull();
  });

  it('returns null for no numeric columns', () => {
    const columns = ['name', 'description'];
    const rows = [
      { name: 'Alice', description: 'A person' },
      { name: 'Bob', description: 'Another person' },
    ];
    expect(inferVisualization(columns, rows, 'User list')).toBeNull();
  });

  it('returns null when only ID column + non-numeric text', () => {
    const columns = ['product_id', 'product_name'];
    const rows = [
      { product_id: 'p1', product_name: 'Widget' },
      { product_id: 'p2', product_name: 'Gadget' },
    ];
    expect(inferVisualization(columns, rows, 'Product listing')).toBeNull();
  });

  it('returns null when category column has too many distinct values', () => {
    const columns = ['username', 'login_count'];
    const rows = Array.from({ length: 50 }, (_, i) => ({
      username: `user_${i}_with_long_suffix`,
      login_count: i,
    }));
    const result = vis(inferVisualization(columns, rows, 'User logins'));
    // username has > MAX_CATEGORIES distinct values → should be text-like
    expect(result).toBeNull();
  });

  it('returns null for text-heavy column with long strings', () => {
    const columns = ['review_text', 'rating'];
    const rows = [
      { review_text: 'A'.repeat(200), rating: 5 },
      { review_text: 'B'.repeat(150), rating: 4 },
    ];
    expect(inferVisualization(columns, rows, 'Reviews')).toBeNull();
  });

  it('returns null when id column detected by name pattern', () => {
    const columns = ['customer_id', 'order_count'];
    const rows = [
      { customer_id: 1, order_count: 5 },
      { customer_id: 2, order_count: 3 },
    ];
    const result = vis(inferVisualization(columns, rows, 'Customer orders'));
    // customer_id is treated as ID-like, and no clear categorical column
    // so the only "meaningful" X candidates are numerics, which doesn't work
    expect(result).toBeNull();
  });
});

// ── Edge cases ──

describe('inferVisualization: edge cases', () => {
  it('handles null/undefined values in rows', () => {
    const columns = ['category', 'amount'];
    const rows = [
      { category: 'A', amount: 10 },
      { category: null, amount: null },
      { category: 'C', amount: 30 },
    ];
    const result = vis(inferVisualization(columns, rows, 'Amount per category'));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('bar');
  });

  it('handles bigint values as numeric', () => {
    const columns = ['month', 'total'];
    const rows = [
      { month: 'Jan', total: BigInt(1000) },
      { month: 'Feb', total: BigInt(2000) },
    ];
    const result = vis(inferVisualization(columns, rows, 'Bigint totals'));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('line');
  });

  it('handles string numeric values in non-temporal columns', () => {
    const columns = ['rank', 'score'];
    const rows = [
      { rank: '1', score: '95' },
      { rank: '2', score: '87' },
    ];
    const result = vis(inferVisualization(columns, rows, 'Rank vs score'));
    expect(result).not.toBeNull();
    // All columns are numeric: first becomes X, rest become Y → bar
    expect(result!.type).toBe('bar');
    expect(result!.xField).toBe('rank');
    expect(result!.yFields).toEqual(['score']);
  });

  it('detects date values by pattern even without date-like column name', () => {
    const columns = ['period', 'sales'];
    const rows = [
      { period: '2025-01-01', sales: 100 },
      { period: '2025-02-01', sales: 150 },
    ];
    const result = vis(inferVisualization(columns, rows, 'Sales over time'));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('line');
  });

  it('numeric-only columns with no meaningful categories returns null', () => {
    const columns = ['min_val', 'max_val', 'avg_val'];
    const rows = [
      { min_val: 1, max_val: 10, avg_val: 5 },
    ];
    expect(inferVisualization(columns, rows, 'Stats summary')).toBeNull();
  });
});
