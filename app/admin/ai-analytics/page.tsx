import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth-guard';
import { AiAnalyticsChat } from '@/components/admin/ai-analytics-chat';

export const metadata: Metadata = {
  title: 'AI Analytics',
};

export default async function AdminAiAnalyticsPage() {
  await requireAdmin();

  return (
    <div className="space-y-2">
      <div>
        <h1 className="h2-bold">AI Analytics</h1>
        <p className="text-muted-foreground mt-1">
          Ask questions about your store data in natural language. The AI will
          generate and run SQL against your analytics database.
        </p>
      </div>
      <AiAnalyticsChat />
    </div>
  );
}
