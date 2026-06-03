'use client';

import { useChat as useAIChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, useCallback } from 'react';

export function useChat(productId?: string) {
  const [input, setInput] = useState('');

  const { messages, status, sendMessage, stop, error } = useAIChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { productId },
    }),
    onError: (err) => {
      console.error('Chat error:', err);
    },
  });

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement> | { target: { value: string } }) => {
      setInput(e.target.value);
    },
    [],
  );

  const handleSubmit = useCallback(
    async (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.();
      const text = input.trim();
      if (!text || status === 'streaming') return;
      setInput('');
      await sendMessage({ text });
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
  };
}
