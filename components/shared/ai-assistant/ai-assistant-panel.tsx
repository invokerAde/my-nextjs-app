'use client';

import { useChat } from '@/lib/hooks/use-chat';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Send, Loader2, Search } from 'lucide-react';
import { useRef, useEffect } from 'react';
import { ChatMessageCard } from './chat-message-card';

const SUGGESTED_QUESTIONS = [
  '100元以内棉质长袖有什么推荐？',
  '这款的尺码偏大还是偏小？',
  '7天退货政策是什么？',
  '和另一款面料有什么区别？',
];

export function AiAssistantPanel({
  productId,
  onClose,
}: {
  productId?: string;
  onClose: () => void;
}) {
  const { messages, input, handleInputChange, handleSubmit, status, error, sendMessage } = useChat(productId);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  const isLoading = status === 'submitted' || status === 'streaming';

  return (
    <div className="fixed bottom-24 right-6 z-50 flex h-[560px] w-[400px] flex-col rounded-lg border bg-background shadow-2xl">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-semibold">AI 导购助手</h3>
        <Button variant="ghost" size="icon" onClick={onClose}>✕</Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground mt-16">
            <Search className="mx-auto h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">我可以帮您找商品、比参数、看评价</p>
            <div className="mt-4 space-y-2">
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-left"
                  onClick={() => {
                    if (status === 'streaming') return;
                    sendMessage({ text: q });
                  }}
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg: any, i: number) => (
          <ChatMessageCard key={i} message={msg} />
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>思考中...</span>
          </div>
        )}

        {error && (
          <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            错误: {error.message}
          </div>
        )}

        {status === 'error' && !error && (
          <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            发生未知错误
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t p-3">
        <Input
          value={input}
          onChange={handleInputChange}
          placeholder="问我关于商品的问题..."
          disabled={isLoading}
        />
        <Button type="submit" size="icon" disabled={isLoading}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
