export interface ChatMetrics {
  ttfb: number;
  totalDuration: number;
  retrievalCalls: number;
  retrievalDuration: number;
  sqlUsed: boolean;
  ftsUsed: boolean;
  vectorUsed: boolean;
  confidence: 'high' | 'medium' | 'low';
  tokenCount: number;
  answerLength: number;
}

const metricsBuffer: ChatMetrics[] = [];

export function recordMetrics(m: ChatMetrics): void {
  metricsBuffer.push(m);
  console.log(
    `[Metrics] TTFB=${m.ttfb}ms total=${m.totalDuration}ms retCalls=${m.retrievalCalls} ` +
    `sql=${m.sqlUsed} fts=${m.ftsUsed} vec=${m.vectorUsed} ` +
    `conf=${m.confidence} tokens=${m.tokenCount} ansLen=${m.answerLength}`,
  );
  if (metricsBuffer.length >= 100) {
    console.log(`[Metrics] Flushing ${metricsBuffer.length} records`);
    metricsBuffer.length = 0;
  }
}
