/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// Mock @/lib/utils to avoid ESM import of query-string from node_modules
jest.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { AiAnalyticsChat } from '@/components/admin/ai-analytics-chat';

// Mock global fetch
const originalFetch = global.fetch;
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// jsdom does not implement scrollIntoView
const originalScrollIntoView = Element.prototype.scrollIntoView;
Element.prototype.scrollIntoView = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
});

afterAll(() => {
  global.fetch = originalFetch;
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

// ── Helper: build a mock success response ──

function mockSuccess(overrides: Record<string, unknown> = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      sql: 'SELECT * FROM admin_product_analytics_view LIMIT 10',
      columns: ['product_name', 'price', 'category'],
      rows: [
        { product_name: 'Widget A', price: 19.99, category: 'Tools' },
        { product_name: 'Widget B', price: 29.99, category: 'Tools' },
      ],
      rowCount: 2,
      attempts: 1,
      executionMs: 42,
      warnings: [],
      knowledgeSources: ['retrieved:sql_ddl', 'retrieved:sql_description'],
      visualization: null,
      ...overrides,
    }),
  } as unknown as Response);
}

function mockError(status: number, body: Record<string, unknown>) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => body,
  } as unknown as Response);
}

function mockNetworkError(message: string) {
  mockFetch.mockRejectedValueOnce(new Error(message));
}

// ── Tests ──

describe('AiAnalyticsChat', () => {
  it('renders the empty state with suggested questions', () => {
    render(<AiAnalyticsChat />);

    expect(screen.getByPlaceholderText('Ask a question about your store data...')).toBeInTheDocument();
    expect(screen.getByText('What are the top 10 products by total sales?')).toBeInTheDocument();
    expect(screen.getByText('Show me monthly order counts for the last 6 months')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
  });

  it('enables the Ask button when input has text', () => {
    render(<AiAnalyticsChat />);

    const input = screen.getByPlaceholderText('Ask a question about your store data...');
    fireEvent.change(input, { target: { value: 'How many products?' } });

    expect(screen.getByRole('button', { name: 'Ask' })).not.toBeDisabled();
  });

  it('clicking a suggested question fills the input', () => {
    render(<AiAnalyticsChat />);

    fireEvent.click(screen.getByText('What are the top 10 products by total sales?'));

    const input = screen.getByPlaceholderText('Ask a question about your store data...');
    expect(input).toHaveValue('What are the top 10 products by total sales?');
  });

  it('renders user message and assistant result on success', async () => {
    mockSuccess();
    render(<AiAnalyticsChat />);

    const input = screen.getByPlaceholderText('Ask a question about your store data...');
    fireEvent.change(input, { target: { value: 'Top products?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    // User message appears
    await waitFor(() => {
      expect(screen.getByText('Top products?')).toBeInTheDocument();
    });

    // Assistant result: table headers
    await waitFor(() => {
      expect(screen.getByText('product_name')).toBeInTheDocument();
      expect(screen.getByText('price')).toBeInTheDocument();
      expect(screen.getByText('category')).toBeInTheDocument();
    });

    // Table row data
    expect(screen.getByText('Widget A')).toBeInTheDocument();
    expect(screen.getByText('19.99')).toBeInTheDocument();

    // Execution info
    expect(screen.getByText('2 rows')).toBeInTheDocument();
    expect(screen.getByText('42ms')).toBeInTheDocument();

    // SQL is in a details element
    expect(screen.getByText('Generated SQL')).toBeInTheDocument();
  });

  it('renders empty result state when rowCount is 0', async () => {
    mockSuccess({ rows: [], rowCount: 0, columns: [] });
    render(<AiAnalyticsChat />);

    fireEvent.change(screen.getByPlaceholderText('Ask a question about your store data...'), {
      target: { value: 'Empty query' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => {
      expect(screen.getByText('No results')).toBeInTheDocument();
      expect(screen.getByText('The query returned 0 rows.')).toBeInTheDocument();
    });
  });

  it('renders structured error on 500 without clearing history', async () => {
    // First: a successful message
    mockSuccess();
    render(<AiAnalyticsChat />);

    const input = screen.getByPlaceholderText('Ask a question about your store data...');
    fireEvent.change(input, { target: { value: 'First question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => {
      expect(screen.getByText('First question')).toBeInTheDocument();
      expect(screen.getByText('Widget A')).toBeInTheDocument();
    });

    // Second: an error
    mockError(500, {
      error: 'Text2SQL execution failed',
      detail: 'relation "nonexistent" does not exist',
      sql: 'SELECT * FROM nonexistent',
      attempts: 2,
      warnings: ['Exec attempt 1 failed'],
    });

    fireEvent.change(input, { target: { value: 'Bad query' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => {
      expect(screen.getByText('Text2SQL execution failed')).toBeInTheDocument();
      expect(
        screen.getByText('relation "nonexistent" does not exist')
      ).toBeInTheDocument();
      expect(screen.getByText('Exec attempt 1 failed')).toBeInTheDocument();
    });

    // Previous messages are still visible
    expect(screen.getByText('First question')).toBeInTheDocument();
    expect(screen.getByText('Widget A')).toBeInTheDocument();
  });

  it('renders network error without clearing history', async () => {
    mockSuccess();
    render(<AiAnalyticsChat />);

    const input = screen.getByPlaceholderText('Ask a question about your store data...');
    fireEvent.change(input, { target: { value: 'Good query' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => {
      expect(screen.getByText('Good query')).toBeInTheDocument();
    });

    mockNetworkError('Failed to fetch');

    fireEvent.change(input, { target: { value: 'Network fail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
      expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
    });

    // Previous messages persist
    expect(screen.getByText('Good query')).toBeInTheDocument();
  });

  it('renders null/undefined as dash and objects as JSON', async () => {
    mockSuccess({
      columns: ['name', 'meta', 'missing'],
      rows: [
        {
          name: 'Test',
          meta: { key: 'value' },
          missing: null,
        },
      ],
      rowCount: 1,
    });
    render(<AiAnalyticsChat />);

    fireEvent.change(screen.getByPlaceholderText('Ask a question about your store data...'), {
      target: { value: 'Test query' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => {
      expect(screen.getByText('Test')).toBeInTheDocument();
      expect(screen.getByText('{"key":"value"}')).toBeInTheDocument();
      expect(screen.getByText('-')).toBeInTheDocument();
    });
  });

  it('renders warnings as badges', async () => {
    mockSuccess({
      warnings: ['Approximate result', 'Timeout adjusted'],
    });
    render(<AiAnalyticsChat />);

    fireEvent.change(screen.getByPlaceholderText('Ask a question about your store data...'), {
      target: { value: 'Query with warnings' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => {
      expect(screen.getByText('Approximate result')).toBeInTheDocument();
      expect(screen.getByText('Timeout adjusted')).toBeInTheDocument();
    });
  });

  it('submits on Enter key', async () => {
    mockSuccess();
    render(<AiAnalyticsChat />);

    const input = screen.getByPlaceholderText('Ask a question about your store data...');
    fireEvent.change(input, { target: { value: 'Enter submit test' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(screen.getByText('Enter submit test')).toBeInTheDocument();
    });
  });

  it('does not submit on Shift+Enter', async () => {
    render(<AiAnalyticsChat />);

    const input = screen.getByPlaceholderText('Ask a question about your store data...');
    fireEvent.change(input, { target: { value: 'No submit' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    // fetch should not have been called, input retains value
    expect(mockFetch).not.toHaveBeenCalled();
    expect(input).toHaveValue('No submit');
  });

  it('renders chart when visualization is present (v2 spec)', async () => {
    mockSuccess({
      columns: ['category', 'total_sales'],
      rows: [
        { category: 'Electronics', total_sales: 15000 },
        { category: 'Clothing', total_sales: 8000 },
      ],
      rowCount: 2,
      visualization: {
        schemaVersion: 2,
        type: 'bar',
        title: 'Sales by category',
        xAxis: { field: 'category' },
        series: [{ field: 'total_sales' }],
      },
    });
    render(<AiAnalyticsChat />);

    fireEvent.change(screen.getByPlaceholderText('Ask a question about your store data...'), {
      target: { value: 'Sales by category' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    // Chart title should be visible
    await waitFor(() => {
      expect(screen.getByText('Sales by category')).toBeInTheDocument();
    });

    // Table is still rendered below the chart
    expect(screen.getByText('category')).toBeInTheDocument();
    expect(screen.getByText('total_sales')).toBeInTheDocument();
    expect(screen.getByText('Electronics')).toBeInTheDocument();

    // ResponsiveContainer renders
    expect(document.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });

  it('does not render chart when visualization is null', async () => {
    mockSuccess({
      columns: ['product_name', 'price'],
      rows: [{ product_name: 'Widget', price: 9.99 }],
      rowCount: 1,
      visualization: null,
    });
    render(<AiAnalyticsChat />);

    fireEvent.change(screen.getByPlaceholderText('Ask a question about your store data...'), {
      target: { value: 'Simple query' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => {
      expect(screen.getByText('product_name')).toBeInTheDocument();
      expect(screen.getByText('Widget')).toBeInTheDocument();
    });

    // No recharts container
    expect(document.querySelector('.recharts-responsive-container')).not.toBeInTheDocument();
  });

  it('disables input and button while loading', async () => {
    // Use a promise that never resolves to keep loading state
    let resolvePromise!: (value: unknown) => void;
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
    );

    render(<AiAnalyticsChat />);

    const input = screen.getByPlaceholderText('Ask a question about your store data...');
    fireEvent.change(input, { target: { value: 'Loading test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => {
      expect(input).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
    });

    // Cleanup: resolve the promise
    resolvePromise({
      ok: true,
      json: async () => ({
        sql: '',
        columns: [],
        rows: [],
        rowCount: 0,
        attempts: 1,
        executionMs: 0,
        warnings: [],
        knowledgeSources: [],
      }),
    });
  });
});
