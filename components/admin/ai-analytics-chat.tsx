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


// ── Component ──

export function AiAnalyticsChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef(0);

  function nextId(): string {
    counterRef.current++;
    return `msg-${Date.now()}-${counterRef.current}`;
  }

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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reach the server';
      const assistantMsg: ChatMessage = {
        id: nextId(),
        role: 'assistant',
        question: q,
        error: 'Network error',
        errorDetail: message,
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
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
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
