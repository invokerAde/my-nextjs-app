'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import Image from 'next/image';

export function ChatMessageCard({ message }: { message: any }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg bg-primary px-4 py-2 text-primary-foreground text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  const toolInvocations = message.parts?.filter((p: any) => p.type === 'tool-invocation') || [];

  return (
    <div className="space-y-2">
      {toolInvocations.map((ti: any, i: number) => {
        if (ti.state === 'call') {
          return (
            <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground py-1">
              <span className="inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
              正在检索商品信息...
            </div>
          );
        }
        if (ti.state === 'result' && ti.result?.hits?.length > 0) {
          return (
            <div key={i} className="space-y-1">
              <Badge variant="secondary" className="text-xs">
                检索到 {ti.result.hits.length} 条相关信息
              </Badge>
              {ti.result.hits.slice(0, 3).map((hit: any, j: number) => (
                <div key={j} className="flex items-start gap-2 rounded border p-2 text-xs">
                  <Badge variant="outline" className="shrink-0">
                    {hit.source}
                  </Badge>
                  <p className="line-clamp-2 text-muted-foreground">{hit.content}</p>
                </div>
              ))}
            </div>
          );
        }
        return null;
      })}

      {message.content && (
        <div className="text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
      )}
    </div>
  );
}
