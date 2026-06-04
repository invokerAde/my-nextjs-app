'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { backfillAllProducts } from '@/lib/services/index.service';
import { generateRagFixtures } from '@/lib/services/fixture.service';
import { RefreshCw, FlaskConical, CheckCircle2, AlertCircle } from 'lucide-react';

export function RagAdminPanel() {
  // ── Backfill state ──
  const [bfStatus, setBfStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [bfResult, setBfResult] = useState<{
    total: number;
    indexed: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  // ── Fixture state ──
  const [fxStatus, setFxStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [fxResult, setFxResult] = useState<{
    products: number;
    specs: number;
    reviews: number;
    productDocs: number;
    policyDocs: number;
    errors: string[];
  } | null>(null);

  const handleBackfill = async () => {
    setBfStatus('loading');
    setBfResult(null);
    try {
      const r = await backfillAllProducts();
      setBfResult(r);
      setBfStatus('done');
    } catch {
      setBfStatus('error');
    }
  };

  const handleFixtures = async () => {
    setFxStatus('loading');
    setFxResult(null);
    try {
      const r = await generateRagFixtures();
      setFxResult(r);
      setFxStatus('done');
    } catch {
      setFxStatus('error');
    }
  };

  return (
    <Card className="w-full max-w-md space-y-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <FlaskConical className="h-4 w-4" />
          RAG 开发工具
        </CardTitle>
        <CardDescription className="text-xs">
          生成合成测试数据或重建向量索引。已有数据的商品自动跳过。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* ── Fixture button ── */}
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-xs font-medium">测试数据生成</p>
          <p className="text-xs text-muted-foreground">
            为所有商品生成规格、富文本详情、评论（8-15条）和 FAQ 政策文档，再自动索引。
          </p>
          <Button
            onClick={handleFixtures}
            disabled={fxStatus === 'loading'}
            variant="outline"
            size="sm"
            className="w-full"
          >
            {fxStatus === 'loading' ? (
              <>
                <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <FlaskConical className="mr-2 h-3.5 w-3.5" />
                生成 RAG 测试数据
              </>
            )}
          </Button>
          {fxStatus === 'done' && fxResult && (
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="default" className="text-xs">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                {fxResult.products} 件商品
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {fxResult.reviews} 条评论
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {fxResult.productDocs + fxResult.policyDocs} 篇文档
              </Badge>
              {fxResult.errors.length > 0 && (
                <Badge variant="destructive" className="text-xs">
                  <AlertCircle className="mr-1 h-3 w-3" />
                  错误 {fxResult.errors.length}
                </Badge>
              )}
            </div>
          )}
          {fxStatus === 'error' && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />失败，请重试
            </p>
          )}
        </div>

        {/* ── Backfill button ── */}
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-xs font-medium">向量索引重建</p>
          <p className="text-xs text-muted-foreground">
            对所有商品执行 chunk → embedding → 入库。已索引且内容未变的自动跳过。
          </p>
          <Button
            onClick={handleBackfill}
            disabled={bfStatus === 'loading'}
            variant="outline"
            size="sm"
            className="w-full"
          >
            {bfStatus === 'loading' ? (
              <>
                <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                重建中...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                重建向量索引
              </>
            )}
          </Button>
          {bfStatus === 'done' && bfResult && (
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="default" className="text-xs">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                共 {bfResult.total} 件
              </Badge>
              <Badge variant="secondary" className="text-xs">
                已索引 {bfResult.indexed}
              </Badge>
              {bfResult.skipped > 0 && (
                <Badge variant="outline" className="text-xs">跳过 {bfResult.skipped}</Badge>
              )}
              {bfResult.errors.length > 0 && (
                <Badge variant="destructive" className="text-xs">
                  <AlertCircle className="mr-1 h-3 w-3" />错误 {bfResult.errors.length}
                </Badge>
              )}
            </div>
          )}
          {bfStatus === 'error' && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />失败，请重试
            </p>
          )}
        </div>

      </CardContent>
    </Card>
  );
}
