'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { backfillAllProducts } from '@/lib/services/index.service';

export function BackfillButton() {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleBackfill = async () => {
    setLoading(true);
    setStatus('正在初始化向量索引...');
    try {
      const result = await backfillAllProducts();
      setStatus(
        `完成：共 ${result.total} 件商品，已索引 ${result.indexed}，跳过 ${result.skipped}${result.errors.length ? `，错误 ${result.errors.length}` : ''}`,
      );
    } catch (err: any) {
      setStatus(`失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button onClick={handleBackfill} disabled={loading} variant="outline">
        {loading ? '处理中...' : '初始化向量索引'}
      </Button>
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
    </div>
  );
}
