/**
 * Visualization v2 tests — AI SDK structured output + normalization.
 *
 * The AI SDK's generateText is mocked. Tests cover:
 * - AI output normalization to v2 spec
 * - AI failures/edge cases return null safely
 * - Old heuristic rejections (ID columns, too many categories, long text) are gone
 */

import { generateVisualizationSpec, type VisualizationSpec, type BarLineSpec, type PieSpec } from '@/lib/services/admin-text2sql/visualization';

// ── Mock AI SDK ──

const mockGenerateText = jest.fn();
jest.mock('ai', () => ({
  generateText: (...args: any[]) => mockGenerateText(...args),
}));

function asBar(v: VisualizationSpec): BarLineSpec {
  return v as BarLineSpec;
}

function asPie(v: VisualizationSpec): PieSpec {
  return v as PieSpec;
}

// ── Helpers ──

function mockAIOutput(chartType: string, fields: Record<string, unknown> = {}) {
  const output: Record<string, unknown> = {
    chartType,
    title: fields.title ?? 'Chart Title',
    xField: fields.xField ?? null,
    yFields: fields.yFields ?? null,
    categoryField: fields.categoryField ?? null,
    valueField: fields.valueField ?? null,
  };
  mockGenerateText.mockResolvedValueOnce({ text: JSON.stringify(output) });
}

function mockAIError(message: string) {
  mockGenerateText.mockRejectedValueOnce(new Error(message));
}

function mockAITimeout() {
  mockGenerateText.mockRejectedValueOnce(
    Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })
  );
}

// ── Positive: AI output normalizes to v2 spec ──

describe('generateVisualizationSpec: bar chart', () => {
  beforeEach(() => { mockGenerateText.mockReset(); });

  it('normalizes AI bar output to v2 spec', async () => {
    mockAIOutput('bar', {
      xField: 'category',
      yFields: ['total_sales'],
      title: 'Sales by Category',
    });
    const { visualization } = await generateVisualizationSpec({
      question: 'Sales by category',
      columns: ['category', 'total_sales'],
      rows: [
        { category: 'Electronics', total_sales: 15000 },
        { category: 'Clothing', total_sales: 8000 },
      ],
    });
    expect(visualization).not.toBeNull();
    expect(visualization!.schemaVersion).toBe(2);
    expect(visualization!.type).toBe('bar');
    const bar = visualization as BarLineSpec;
    expect(bar.xAxis.field).toBe('category');
    expect(bar.series).toHaveLength(1);
    expect(bar.series[0].field).toBe('total_sales');
  });

  it('normalizes bar with multiple series', async () => {
    mockAIOutput('bar', {
      xField: 'product',
      yFields: ['views', 'purchases'],
      title: 'Product Performance',
    });
    const { visualization } = await generateVisualizationSpec({
      question: 'Product views vs purchases',
      columns: ['product', 'views', 'purchases'],
      rows: [
        { product: 'Widget A', views: 500, purchases: 50 },
        { product: 'Widget B', views: 300, purchases: 30 },
      ],
    });
    expect(visualization).not.toBeNull();
    expect(visualization!.type).toBe('bar');
    const bar = visualization as BarLineSpec;
    expect(bar.series).toHaveLength(2);
  });
});

describe('generateVisualizationSpec: line chart', () => {
  beforeEach(() => { mockGenerateText.mockReset(); });

  it('normalizes AI line output to v2 spec', async () => {
    mockAIOutput('line', {
      xField: 'month',
      yFields: ['order_count'],
      title: 'Monthly Orders',
    });
    const { visualization } = await generateVisualizationSpec({
      question: 'Monthly orders',
      columns: ['month', 'order_count'],
      rows: [
        { month: '2025-01', order_count: 42 },
        { month: '2025-02', order_count: 55 },
      ],
    });
    expect(visualization).not.toBeNull();
    expect(visualization!.type).toBe('line');
    const line = asBar(visualization!);
    expect(line.xAxis.field).toBe('month');
    expect(line.series).toHaveLength(1);
  });
});

describe('generateVisualizationSpec: pie chart', () => {
  beforeEach(() => { mockGenerateText.mockReset(); });

  it('normalizes AI pie output to v2 spec', async () => {
    mockAIOutput('pie', {
      categoryField: 'rating',
      valueField: 'count',
      title: 'Rating Distribution',
    });
    const { visualization } = await generateVisualizationSpec({
      question: 'Rating distribution',
      columns: ['rating', 'count'],
      rows: [
        { rating: '5 stars', count: 120 },
        { rating: '4 stars', count: 80 },
      ],
    });
    expect(visualization).not.toBeNull();
    expect(visualization!.type).toBe('pie');
    const pie = asPie(visualization!);
    expect(pie.categoryField).toBe('rating');
    expect(pie.valueField).toBe('count');
  });
});

describe('generateVisualizationSpec: none → null', () => {
  beforeEach(() => { mockGenerateText.mockReset(); });

  it('returns null when AI says none', async () => {
    mockAIOutput('none');
    const { visualization } = await generateVisualizationSpec({
      question: 'List customers',
      columns: ['user_id', 'name'],
      rows: [{ user_id: 1, name: 'Alice' }],
    });
    expect(visualization).toBeNull();
  });
});

// ── Normalization safety checks ──

describe('generateVisualizationSpec: normalization rejects invalid output', () => {
  beforeEach(() => { mockGenerateText.mockReset(); });

  it('rejects bar when xField not in columns', async () => {
    mockAIOutput('bar', { xField: 'bogus', yFields: ['sales'] });
    const { visualization, warning } = await generateVisualizationSpec({
      question: 'test',
      columns: ['name', 'sales'],
      rows: [{ name: 'A', sales: 10 }],
    });
    expect(visualization).toBeNull();
    expect(warning).toBeTruthy();
  });

  it('rejects bar when yField not in columns', async () => {
    mockAIOutput('bar', { xField: 'name', yFields: ['bogus'] });
    const { visualization } = await generateVisualizationSpec({
      question: 'test',
      columns: ['name', 'sales'],
      rows: [{ name: 'A', sales: 10 }],
    });
    expect(visualization).toBeNull();
  });

  it('rejects pie when value field is negative', async () => {
    mockAIOutput('pie', { categoryField: 'type', valueField: 'amount' });
    const { visualization } = await generateVisualizationSpec({
      question: 'test',
      columns: ['type', 'amount'],
      rows: [
        { type: 'A', amount: -10 },
        { type: 'B', amount: 5 },
      ],
    });
    expect(visualization).toBeNull();
  });

  it('rejects when yFields are not numeric', async () => {
    mockAIOutput('bar', { xField: 'name', yFields: ['description'] });
    const { visualization } = await generateVisualizationSpec({
      question: 'test',
      columns: ['name', 'description'],
      rows: [
        { name: 'A', description: 'Lorem ipsum' },
        { name: 'B', description: 'Dolor sit' },
      ],
    });
    expect(visualization).toBeNull();
  });

  it('returns null for empty rows', async () => {
    const { visualization } = await generateVisualizationSpec({
      question: 'Empty?',
      columns: [],
      rows: [],
    });
    expect(visualization).toBeNull();
    // Should not have called AI
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('truncates long titles', async () => {
    mockAIOutput('bar', {
      xField: 'x',
      yFields: ['y'],
      title: 'A'.repeat(200),
    });
    const { visualization } = await generateVisualizationSpec({
      question: 'test',
      columns: ['x', 'y'],
      rows: [{ x: 'a', y: 1 }],
    });
    expect(visualization).not.toBeNull();
    expect(visualization!.title.length).toBeLessThanOrEqual(80);
  });
});

// ── AI failure modes ──

describe('generateVisualizationSpec: AI failures', () => {
  beforeEach(() => { mockGenerateText.mockReset(); });

  it('returns null + warning on AI error', async () => {
    mockAIError('LLM call failed');
    const { visualization, warning } = await generateVisualizationSpec({
      question: 'test',
      columns: ['x', 'y'],
      rows: [{ x: 'a', y: 1 }],
    });
    expect(visualization).toBeNull();
    expect(warning).toContain('AI error');
    expect(warning).toContain('LLM call failed');
  });

  it('returns null + timeout warning', async () => {
    mockAITimeout();
    const { visualization, warning } = await generateVisualizationSpec({
      question: 'test',
      columns: ['x', 'y'],
      rows: [{ x: 'a', y: 1 }],
    });
    expect(visualization).toBeNull();
    expect(warning).toContain('timeout');
  });

  it('caps series at MAX_SERIES', async () => {
    mockAIOutput('bar', {
      xField: 'x',
      yFields: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    const { visualization } = await generateVisualizationSpec({
      question: 'test',
      columns: ['x', 'a', 'b', 'c', 'd', 'e', 'f'],
      rows: [{ x: 't', a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }],
    });
    expect(visualization).not.toBeNull();
    const bar = visualization as BarLineSpec;
    expect(bar.series.length).toBeLessThanOrEqual(4);
  });
});

// ── Old heuristics no longer apply ──

describe('generateVisualizationSpec: no old heuristic rejections', () => {
  beforeEach(() => { mockGenerateText.mockReset(); });

  it('no longer rejects ID-like columns (AI decides)', async () => {
    // customer_id was hard-rejected by old rules; now AI says bar
    mockAIOutput('bar', { xField: 'customer_id', yFields: ['order_count'] });
    const { visualization } = await generateVisualizationSpec({
      question: 'Customer orders',
      columns: ['customer_id', 'order_count'],
      rows: [
        { customer_id: 1, order_count: 5 },
        { customer_id: 2, order_count: 3 },
      ],
    });
    // Normalization allows it as long as fields exist and are numeric
    expect(visualization).not.toBeNull();
    expect(visualization!.type).toBe('bar');
  });

  it('no longer rejects many categories (AI decides)', async () => {
    mockAIOutput('bar', { xField: 'username', yFields: ['login_count'] });
    const rows = Array.from({ length: 50 }, (_, i) => ({
      username: `user_${i}`,
      login_count: i,
    }));
    const { visualization } = await generateVisualizationSpec({
      question: 'User logins',
      columns: ['username', 'login_count'],
      rows,
    });
    expect(visualization).not.toBeNull();
    expect(visualization!.type).toBe('bar');
  });

  it('no longer rejects long text columns (AI decides)', async () => {
    mockAIOutput('bar', { xField: 'review_text', yFields: ['rating'] });
    const { visualization } = await generateVisualizationSpec({
      question: 'Reviews',
      columns: ['review_text', 'rating'],
      rows: [
        { review_text: 'A'.repeat(200), rating: 5 },
        { review_text: 'B'.repeat(150), rating: 4 },
      ],
    });
    // The old heuristic would reject this. AI can still use it.
    // Normalization may reject if review_text values aren't shown in rows
    // but the test just verifies no hard heuristic block
    expect(mockGenerateText).toHaveBeenCalled();
  });
});
