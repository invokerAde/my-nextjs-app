import { classifyIntent } from '@/lib/services/intent.service';
import { reciprocalRankFusion, RetrievalHit } from '@/lib/services/rrf.service';

describe('Retrieval pipeline integration', () => {
  it('intent → RRF works for filter query', () => {
    const intent = classifyIntent('100元以内棉质长袖衬衫有什么推荐？');
    expect(intent.intent).toBe('product_filter');

    const ftsHits: RetrievalHit[] = [
      { id: 'c1', score: 0.8, source: 'fts', content: '棉质长袖衬衫...' },
    ];
    const vecHits: RetrievalHit[] = [
      { id: 'c1', score: 0.85, source: 'vector', content: '棉质长袖衬衫...' },
      { id: 'c2', score: 0.7, source: 'vector', content: '纯棉衬衫...' },
    ];
    const merged = reciprocalRankFusion([ftsHits, vecHits]);
    expect(merged.length).toBeGreaterThanOrEqual(1);
  });

  it('all realtime queries are time-sensitive', () => {
    const queries = ['这件衣服多少钱？', '这款还有M码吗？', '现在有什么优惠？'];
    for (const q of queries) {
      expect(classifyIntent(q).intent).toBe('realtime_price_stock');
    }
  });

  it('RRF deduplicates across sources', () => {
    const fts: RetrievalHit[] = [{ id: 'A', score: 10, source: 'fts' }];
    const vec: RetrievalHit[] = [{ id: 'A', score: 0.9, source: 'vector' }, { id: 'B', score: 0.5, source: 'vector' }];
    const result = reciprocalRankFusion([fts, vec]);
    expect(result.filter(r => r.id === 'A')).toHaveLength(1);
  });
});
