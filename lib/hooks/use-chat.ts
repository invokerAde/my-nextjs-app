'use client';

import { useChat as useAIChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, useCallback, useEffect } from 'react';

export function useChat(productId?: string) {
  const [input, setInput] = useState('');

  const { messages, sendMessage, status, stop, error } = useAIChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { productId },
    }),
    onError: (err) => {
      console.error('Chat error:', err);
    },
  });

  // Diagnostic logging
  useEffect(() => {
    console.log('[useChat] messages updated, count:', messages.length, 'status:', status);
  }, [messages, status]);

  useEffect(() => {
    if (error) {
      console.error('[useChat] error state:', error);
    }
  }, [error]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement> | { target: { value: string } }) => {
      setInput(e.target.value);
    },
    [],
  );

  const handleSubmit = useCallback(
    (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.();
      const text = input.trim();
      console.log('[useChat] handleSubmit called, text:', text, 'status:', status);
      if (!text || status === 'streaming') {
        console.log('[useChat] handleSubmit blocked: empty text or streaming');
        return;
      }
      setInput('');
      console.log('[useChat] calling sendMessage with:', text);
      sendMessage({ text });
    },
    [input, status, sendMessage],
  );

  return {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    status,
    stop,
    error,
    sendMessage,
  };
}
