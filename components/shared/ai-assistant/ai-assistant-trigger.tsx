'use client';

import { Button } from '@/components/ui/button';
import { MessageCircle, X } from 'lucide-react';
import { useState } from 'react';
import { AiAssistantPanel } from './ai-assistant-panel';

export function AiAssistantTrigger({ productId }: { productId?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg"
        size="icon"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </Button>

      {open && <AiAssistantPanel productId={productId} onClose={() => setOpen(false)} />}
    </>
  );
}
