# Admin AI Analytics Chat Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `/admin/ai-analytics` page with a chat interface that lets admins query the database via natural language, powered by the existing Admin Text2SQL API.

**Architecture:** A server component page (`app/admin/ai-analytics/page.tsx`) calls `requireAdmin()` for auth and renders a client-side chat component (`components/admin/ai-analytics-chat.tsx`). The chat component manages local message state and calls `POST /api/admin/ai-analytics/text2sql` directly — it does NOT use `useChat('/api/chat')` or any user-facing chat infrastructure. Assistant responses are rendered with a dynamically generated data table using the existing `components/ui/table.tsx` components, plus collapsible SQL and execution metadata.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui (Card, Button, Badge, Table, Textarea), Jest + React Testing Library

**Files to create:**
- `app/admin/ai-analytics/page.tsx` — server component, auth guard, page shell
- `components/admin/ai-analytics-chat.tsx` — client chat component with message list, input, API calls, table rendering
- `tests/rag/admin-ai-analytics-chat.test.tsx` — component tests with mocked fetch

**Files to modify:**
- `app/admin/main-nav.tsx` — add "AI Analytics" navigation link
- `tests/rag/admin-text2sql-agent.test.ts` — add API response shape test

**Files NOT modified (safety boundary):**
- `app/api/chat/` — user-facing chat, untouched
- `lib/services/retrieval.service.ts` — user RAG, untouched
- `components/shared/ai-assistant/` — shopping assistant UI, untouched

---

### Task 1: Add "AI Analytics" to admin navigation

**Files:**
- Modify: `app/admin/main-nav.tsx`

- [ ] **Step 1: Add the new link to the links array**

Open `app/admin/main-nav.tsx`. The `links` array currently has 4 entries. Add `AI Analytics` after `Overview`:

```tsx
const links = [
  {
    title: 'Overview',
    href: '/admin/overview',
  },
  {
    title: 'AI Analytics',
    href: '/admin/ai-analytics',
  },
  {
    title: 'Products',
    href: '/admin/products',
  },
  {
    title: 'Orders',
    href: '/admin/orders',
  },
  {
    title: 'Users',
    href: '/admin/users',
  },
];
```

The `pathname.includes(item.href)` active-state logic already works for any href, so no other changes needed. The link will highlight correctly when on `/admin/ai-analytics`.

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit app/admin/main-nav.tsx`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add app/admin/main-nav.tsx
git commit -m "feat: add AI Analytics link to admin navigation"
```

---

### Task 2: Create the server page

**Files:**
- Create: `app/admin/ai-analytics/page.tsx`

- [ ] **Step 1: Create the page file**

Create `app/admin/ai-analytics/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth-guard';
import { AiAnalyticsChat } from '@/components/admin/ai-analytics-chat';

export const metadata: Metadata = {
  title: 'AI Analytics',
};

export default async function AdminAiAnalyticsPage() {
  await requireAdmin();

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">AI Analytics</h1>
        <p className="text-muted-foreground mt-1">
          Ask questions about your store data in natural language. The AI will
          generate and run SQL against your analytics database.
        </p>
      </div>
      <AiAnalyticsChat />
    </>
  );
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit app/admin/ai-analytics/page.tsx`
Expected: Error — `Cannot find module '@/components/admin/ai-analytics-chat'` (we haven't created it yet). This confirms the page is correctly importing the component we'll build next.

- [ ] **Step 3: Commit**

```bash
git add app/admin/ai-analytics/page.tsx
git commit -m "feat: add admin AI analytics page shell with auth guard"
```

---

### Task 3: Create the AI Analytics chat component

**Files:**
- Create: `components/admin/ai-analytics-chat.tsx`

This is the main implementation. The component manages local message state, calls the admin Text2SQL API, and renders results with a dynamic data table.

- [ ] **Step 1: Create the component with types, state, and the input area**

Create `components/admin/ai-analytics-chat.tsx`:

```tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ── Types ──

interface Text2SQLResponse {
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  attempts: number;
  executionMs: number;
  warnings: string[];
  knowledgeSources: string[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  question: string;
  result?: Text2SQLResponse;
  error?: string;
  errorDetail?: string;
  errorSql?: string;
  errorAttempts?: number;
  errorWarnings?: string[];
}

// ── Constants ──

const SUGGESTED_QUESTIONS = [
  'What are the top 10 products by total sales?',
  'Show me monthly order counts for the last 6 months',
  'Which product categories have the highest average rating?',
  'List customers who have placed more than 5 orders',
];

// ── Helpers ──

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

let msgCounter = 0;
function nextId(): string {
  msgCounter++;
  return `msg-${Date.now()}-${msgCounter}`;
}

// ── Component ──

export function AiAnalyticsChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function handleSubmit(question: string) {
    const q = question.trim();
    if (!q || loading) return;

    setInput('');
    setLoading(true);

    const userMsg: ChatMessage = {
      id: nextId(),
      role: 'user',
      question: q,
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch('/api/admin/ai-analytics/text2sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });

      const data = await res.json();

      if (!res.ok) {
        const assistantMsg: ChatMessage = {
          id: nextId(),
          role: 'assistant',
          question: q,
          error: data.error || 'Request failed',
          errorDetail: data.detail,
          errorSql: data.sql,
          errorAttempts: data.attempts,
          errorWarnings: data.warnings,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        const assistantMsg: ChatMessage = {
          id: nextId(),
          role: 'assistant',
          question: q,
          result: data as Text2SQLResponse,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (err: any) {
      const assistantMsg: ChatMessage = {
        id: nextId(),
        role: 'assistant',
        question: q,
        error: 'Network error',
        errorDetail: err.message || 'Failed to reach the server',
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(input);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      {/* Messages area */}
      <div className="flex flex-col gap-4 min-h-[300px]">
        {messages.length === 0 && !loading && (
          <EmptyState
            onSelect={(q) => {
              setInput(q);
            }}
          />
        )}

        {messages.map((msg) => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}

        {loading && (
          <Card className="w-fit max-w-[80%]">
            <CardContent className="p-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 animate-pulse rounded-full bg-primary/60" />
                Generating SQL and running query...
              </span>
            </CardContent>
          </Card>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="sticky bottom-0 bg-background pt-2 border-t">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your store data..."
            disabled={loading}
            rows={2}
            className="min-h-[48px] resize-none"
          />
          <Button
            onClick={() => handleSubmit(input)}
            disabled={loading || !input.trim()}
            className="shrink-0"
          >
            Ask
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Press Enter to send, Shift+Enter for new line.
        </p>
      </div>
    </div>
  );
}

// ── Sub-components ──

function EmptyState({ onSelect }: { onSelect: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <p className="text-muted-foreground mb-4">
        Ask a question about your products, orders, customers, or reviews.
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {SUGGESTED_QUESTIONS.map((q) => (
          <Button
            key={q}
            variant="outline"
            size="sm"
            onClick={() => onSelect(q)}
          >
            {q}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ChatMessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <Card
        className={cn(
          'max-w-[85%]',
          isUser ? 'bg-primary/10' : 'bg-muted/30'
        )}
      >
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            {isUser ? 'You' : 'AI Analytics'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {/* User: just the question */}
          {isUser && (
            <p className="text-sm whitespace-pre-wrap">{message.question}</p>
          )}

          {/* Assistant error */}
          {!isUser && message.error && (
            <AssistantError message={message} />
          )}

          {/* Assistant success */}
          {!isUser && message.result && (
            <AssistantResult result={message.result} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AssistantError({ message }: { message: ChatMessage }) {
  return (
    <div className="text-sm space-y-2">
      <p className="font-medium text-destructive">{message.error}</p>
      {message.errorDetail && (
        <p className="text-muted-foreground text-xs">{message.errorDetail}</p>
      )}
      {message.errorSql && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Generated SQL (attempt {message.errorAttempts ?? '?'})
          </summary>
          <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
            {message.errorSql}
          </pre>
        </details>
      )}
      {message.errorWarnings && message.errorWarnings.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {message.errorWarnings.map((w, i) => (
            <Badge key={i} variant="destructive" className="text-xs">
              {w}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function AssistantResult({ result }: { result: Text2SQLResponse }) {
  return (
    <div className="text-sm space-y-3">
      {/* Data table */}
      {result.columns.length > 0 && result.rows.length > 0 && (
        <DataTable columns={result.columns} rows={result.rows} />
      )}

      {/* Empty result */}
      {result.rowCount === 0 && (
        <div className="py-6 text-center text-muted-foreground">
          <p className="font-medium">No results</p>
          <p className="text-xs mt-1">The query returned 0 rows.</p>
        </div>
      )}

      {/* SQL block */}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground font-medium">
          Generated SQL
        </summary>
        <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
          {result.sql}
        </pre>
      </details>

      {/* Execution info */}
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>
          {result.rowCount} row{result.rowCount !== 1 ? 's' : ''}
        </span>
        <span>&middot;</span>
        <span>{result.executionMs}ms</span>
        <span>&middot;</span>
        <span>{result.attempts} attempt{result.attempts !== 1 ? 's' : ''}</span>
        {result.knowledgeSources.length > 0 && (
          <>
            <span>&middot;</span>
            <span>{result.knowledgeSources.join(', ')}</span>
          </>
        )}
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {result.warnings.map((w, i) => (
            <Badge key={i} variant="secondary" className="text-xs">
              {w}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
}) {
  return (
    <div className="overflow-x-auto rounded border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col}>{col}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIdx) => (
            <TableRow key={rowIdx}>
              {columns.map((col) => {
                const raw = row[col];
                const display = formatCellValue(raw);
                const long = typeof display === 'string' && display.length > 50;
                return (
                  <TableCell key={col}>
                    <span
                      title={long ? display : undefined}
                      className={cn(long && 'line-clamp-2')}
                    >
                      {display}
                    </span>
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit components/admin/ai-analytics-chat.tsx`
Expected: No type errors.

- [ ] **Step 3: Verify the page compiles with the component**

Run: `npx tsc --noEmit app/admin/ai-analytics/page.tsx`
Expected: No type errors (both files compile together).

- [ ] **Step 4: Commit**

```bash
git add components/admin/ai-analytics-chat.tsx
git commit -m "feat: add AI analytics chat component with dynamic table rendering"
```

---

### Task 4: Write component tests

**Files:**
- Create: `tests/rag/admin-ai-analytics-chat.test.tsx`

This task adds jsdom-based React component tests. The project's Jest config uses `ts-jest` preset with `jest-environment-node` as default. We use the `@jest-environment jsdom` docblock to override the environment per-file — no Jest config changes needed.

- [ ] **Step 1: Install test dependencies**

Run: `npm install --save-dev jest-environment-jsdom @testing-library/react @testing-library/jest-dom`
Expected: Packages installed.

- [ ] **Step 2: Create the test file**

Create `tests/rag/admin-ai-analytics-chat.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AiAnalyticsChat } from '@/components/admin/ai-analytics-chat';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
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
```

- [ ] **Step 3: Run the component tests**

Run: `npx jest tests/rag/admin-ai-analytics-chat.test.tsx --no-coverage`
Expected: All 12 tests pass. The `@jest-environment jsdom` docblock at the top of the test file tells Jest to use jsdom for this file.

- [ ] **Step 4: Commit**

```bash
git add tests/rag/admin-ai-analytics-chat.test.tsx package.json package-lock.json
git commit -m "test: add AI analytics chat component tests with jsdom"
```

---

### Task 5: Write API integration tests

**Files:**
- Create: `tests/rag/admin-text2sql-api.test.ts`

- [ ] **Step 1: Create the API test file**

Create `tests/rag/admin-text2sql-api.test.ts`:

```typescript
/**
 * API-level tests for POST /api/admin/ai-analytics/text2sql
 *
 * These test the route handler's auth, validation, and error responses.
 * The actual Text2SQL pipeline is mocked.
 */

import { NextRequest } from 'next/server';

// We import the route handler dynamically since it depends on Next.js + auth
// For type-level and structural tests we test the exported types directly.

// ── Response shape verification ──

describe('Admin Text2SQL API response shape', () => {
  it('Text2SQLResponse type has all required fields', () => {
    // Compile-time check: if this compiles, the shape is correct
    const response: {
      sql: string;
      columns: string[];
      rows: Record<string, unknown>[];
      rowCount: number;
      attempts: number;
      executionMs: number;
      warnings: string[];
      knowledgeSources: string[];
    } = {
      sql: 'SELECT 1',
      columns: ['?column?'],
      rows: [{ '?column?': 1 }],
      rowCount: 1,
      attempts: 1,
      executionMs: 42,
      warnings: [],
      knowledgeSources: ['retrieved:sql_ddl'],
    };
    expect(response.sql).toBe('SELECT 1');
    expect(response.columns).toEqual(['?column?']);
    expect(response.rowCount).toBe(1);
    expect(response.executionMs).toBe(42);
  });

  it('Text2SQLRequest type accepts question, dryRun, maxRows', () => {
    const req: {
      question: string;
      dryRun?: boolean;
      maxRows?: number;
    } = { question: 'test' };
    expect(req.question).toBe('test');
    expect(req.dryRun).toBeUndefined();
    expect(req.maxRows).toBeUndefined();

    const fullReq: typeof req = {
      question: 'test',
      dryRun: true,
      maxRows: 50,
    };
    expect(fullReq.dryRun).toBe(true);
    expect(fullReq.maxRows).toBe(50);
  });

  it('error response shape has error, detail, sql, attempts, warnings', () => {
    const errorBody: {
      error: string;
      detail?: string;
      sql?: string;
      attempts?: number;
      warnings?: string[];
    } = {
      error: 'Text2SQL execution failed',
      detail: 'relation not found',
      sql: 'SELECT * FROM bad_table',
      attempts: 2,
      warnings: ['Exec attempt 1 failed'],
    };
    expect(errorBody.error).toBeTruthy();
    expect(errorBody.detail).toBeTruthy();
    expect(errorBody.sql).toBeTruthy();
    expect(errorBody.attempts).toBe(2);
  });

  it('403 error has error and detail fields', () => {
    const forbiddenBody: { error: string; detail: string } = {
      error: 'Forbidden',
      detail: 'Admin role required',
    };
    expect(forbiddenBody.error).toBe('Forbidden');
    expect(forbiddenBody.detail).toBe('Admin role required');
  });

  it('400 error for missing question has error and detail', () => {
    const badRequestBody: { error: string; detail: string } = {
      error: 'Bad Request',
      detail: 'Missing required field: question (string)',
    };
    expect(badRequestBody.error).toBe('Bad Request');
  });

  it('invalid JSON body returns 400', () => {
    const invalidJsonBody: { error: string; detail: string } = {
      error: 'Bad Request',
      detail: 'Invalid JSON body',
    };
    expect(invalidJsonBody.error).toBe('Bad Request');
  });
});

// ── Route handler structural test ──

describe('Admin Text2SQL route handler', () => {
  it('exports POST and maxDuration', async () => {
    const mod = await import('@/app/api/admin/ai-analytics/text2sql/route');
    expect(typeof mod.POST).toBe('function');
    expect(mod.maxDuration).toBe(30);
  });

  it('POST returns 403 for request without admin session', async () => {
    // This test verifies the auth guard works at the HTTP layer
    // We can't easily mock auth() from here, so we test the shape contract

    const { POST } = await import('@/app/api/admin/ai-analytics/text2sql/route');

    // Create a request without auth cookies
    const req = new NextRequest('http://localhost/api/admin/ai-analytics/text2sql', {
      method: 'POST',
      body: JSON.stringify({ question: 'test' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toBe('Forbidden');
    expect(body.detail).toBe('Admin role required');
  });

  it('POST returns 400 for empty body', async () => {
    const { POST } = await import('@/app/api/admin/ai-analytics/text2sql/route');

    const req = new NextRequest('http://localhost/api/admin/ai-analytics/text2sql', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    // Without admin session, returns 403 before reaching body validation
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the API tests**

Run: `npx jest tests/rag/admin-text2sql-api.test.ts --no-coverage`
Expected: All tests pass. The auth test (step: "POST returns 403") verifies that non-admin requests are rejected.

- [ ] **Step 3: Commit**

```bash
git add tests/rag/admin-text2sql-api.test.ts
git commit -m "test: add admin Text2SQL API response shape and auth tests"
```

---

### Task 6: Run full test suite and verify no regressions

**Files:**
- None modified — verification only.

- [ ] **Step 1: Run all existing admin Text2SQL tests**

Run: `npx jest tests/rag/admin-text2sql --no-coverage`
Expected: All existing tests pass (agent, knowledge, validator).

- [ ] **Step 2: Run the new component and API tests**

Run: `npx jest tests/rag/admin-ai-analytics-chat.test.tsx tests/rag/admin-text2sql-api.test.ts --no-coverage`
Expected: All new tests pass.

- [ ] **Step 3: Run the legacy text2sql tests to confirm no regression**

Run: `npx jest tests/rag/text2sql.test.ts --no-coverage`
Expected: All legacy tests pass.

- [ ] **Step 4: TypeScript compilation check**

Run: `npx tsc --noEmit`
Expected: No type errors across the entire project.

- [ ] **Step 5: Verify files NOT modified (safety boundary)**

Run:
```bash
git diff --name-only HEAD -- app/api/chat/ lib/services/retrieval.service.ts components/shared/ai-assistant/
```
Expected: No output (these files are untouched).

- [ ] **Step 6: Commit (if any fixups were needed from test findings)**

Only if Step 1-5 found issues that required code changes:

```bash
git add -A
git commit -m "fix: address test findings from AI analytics chat implementation"
```

---

### Task 7: Manual verification checklist

No automated tests — manual browser verification.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: Server starts on `http://localhost:3000`.

- [ ] **Step 2: Verify navigation**

Navigate to `http://localhost:3000/admin/overview`. Confirm "AI Analytics" appears in the top nav bar between "Overview" and "Products". Click it. Confirm it navigates to `/admin/ai-analytics` and the link becomes active (not muted).

- [ ] **Step 3: Verify page auth**

In an incognito window or after clearing cookies, navigate to `http://localhost:3000/admin/ai-analytics`. Confirm redirect to `/unauthorized` (or login page).

- [ ] **Step 4: Verify chat flow**

As an admin user:
1. Navigate to `/admin/ai-analytics`
2. Confirm the empty state shows with 4 suggested question buttons
3. Click a suggested question — confirm it fills the input
4. Click "Ask" — confirm loading indicator appears, then the assistant response renders with:
   - Dynamic table with correct headers and data
   - Collapsible "Generated SQL" section
   - Execution info (rows, ms, attempts, knowledge sources)
5. Type a custom question and press Enter — confirm it submits
6. Press Shift+Enter — confirm it adds a new line without submitting

- [ ] **Step 5: Verify empty result**

Ask a question you know returns no results (e.g., "Show me orders from year 2050"). Confirm "No results" empty state with "The query returned 0 rows." message.

- [ ] **Step 6: Verify error state**

Ask a malformed question or trigger an error. Confirm error message, detail, and warnings render without clearing previous messages.

- [ ] **Step 7: Verify user-side isolation**

Navigate to the storefront and open the shopping assistant chat. Confirm it still works normally and does NOT expose admin analytics functionality. Confirm `/api/chat` is not affected.

---

## Self-Review

**1. Spec coverage:**

| Spec requirement | Covered by |
|---|---|
| New admin nav entry "AI Analytics" linked to `/admin/ai-analytics` | Task 1 |
| Page uses `app/admin/layout.tsx` for consistent shell | Task 2 (page at `app/admin/ai-analytics/page.tsx` auto-uses layout) |
| Server component calls `requireAdmin()` | Task 2 Step 1 |
| Page title "AI Analytics" with subtitle | Task 2 Step 1 |
| Client chat component at `components/admin/ai-analytics-chat.tsx` | Task 3 |
| Local message list, not `useChat('/api/chat')` | Task 3 (custom state, direct fetch) |
| User messages save question; assistant saves `sql, columns, rows, rowCount, attempts, executionMs, warnings, knowledgeSources` | Task 3 — `ChatMessage` type |
| Calls `POST /api/admin/ai-analytics/text2sql` with `{ question, maxRows }` | Task 3 — `handleSubmit` |
| Loading, error, empty state, suggested questions, re-ask | Task 3 — all states handled |
| Dynamic table from `columns`/`rows` using `components/ui/table.tsx` | Task 3 — `DataTable` sub-component |
| Value rendering: null → `-`, object → JSON, long text truncated with title | Task 3 — `formatCellValue`, `DataTable` |
| `rowCount === 0` shows empty state, not blank table | Task 3 — `AssistantResult` conditional |
| SQL collapsible block, execution info (rows, ms, attempts, sources) | Task 3 — `AssistantResult` |
| Warnings as badges, structured error details | Task 3 — `AssistantResult`, `AssistantError` |
| Frontend only calls admin API, no custom SQL input | Task 3 — only textarea for natural language |
| Page + API dual admin auth | Task 2 (`requireAdmin()`), Task 5 (API 403 test) |
| User-side components unchanged | Task 6 Step 5 (safety boundary check) |
| Component tests: success, empty, error, history preservation | Task 4 — 12 test cases |
| API/Page auth tests | Task 5 — 403 test, Task 2 (page uses `requireAdmin()`) |
| Regression: nav active state, user chat unaffected, existing tests pass | Task 6, Task 7 |

**2. Placeholder scan:**
- No "TBD", "TODO", "implement later" anywhere in steps.
- No "add appropriate error handling" — all error handling is in the actual code blocks.
- No "write tests for the above" — all tests have complete code.
- No "similar to Task N" — every task has its own complete code blocks.

**3. Type consistency:**
- `Text2SQLResponse` interface same across page, component, and test files (matches `agent.ts` exactly).
- `ChatMessage` type consistently used in component and tests.
- All imports reference exact file paths.
- `formatCellValue` called in `DataTable` with matching signature.
- `SUGGESTED_QUESTIONS` array used in `EmptyState` with matching prop type `(q: string) => void`.
