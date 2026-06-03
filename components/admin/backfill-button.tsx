'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { backfillAllProducts } from '@/lib/services/index.service';
import { RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

export function BackfillButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<{
    total: number;
    indexed: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  const handleBackfill = async () => {
    setStatus('loading');
    setResult(null);
    try {
      const r = await backfillAllProducts();
      setResult(r);
      setStatus('done');
    } catch (err: any) {
      setResult(null);
      setStatus('error');
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <RefreshCw className={`h-4 w-4 ${status === 'loading' ? 'animate-spin' : ''}`} />
          向量索引管理
        </CardTitle>
        <CardDescription className="text-xs">
          对所有商品执行 chunk → embedding → 入库。已索引且内容未变的商品自动跳过。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          onClick={handleBackfill}
          disabled={status === 'loading'}
          variant="default"
          size="sm"
          className="w-full"
        >
          {status === 'loading' ? (
            <>
              <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
              正在重建索引...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              重建向量索引
            </>
          )}
        </Button>

        {status === 'done' && result && (
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="default" className="text-xs">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              共 {result.total} 件
            </Badge>
            <Badge variant="secondary" className="text-xs">
              已索引 {result.indexed}
            </Badge>
            {result.skipped > 0 && (
              <Badge variant="outline" className="text-xs">
                跳过 {result.skipped}
              </Badge>
            )}
            {result.errors.length > 0 && (
              <Badge variant="destructive" className="text-xs">
                <AlertCircle className="mr-1 h-3 w-3" />
                错误 {result.errors.length}
              </Badge>
            )}
          </div>
        )}

        {status === 'error' && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            请求失败，请重试
          </p>
        )}
      </CardContent>
    </Card>
  );
}
