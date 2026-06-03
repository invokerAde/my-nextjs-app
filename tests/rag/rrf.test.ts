import { reciprocalRankFusion, RetrievalHit } from '@/lib/services/rrf.service';

describe('reciprocalRankFusion', () => {
  it('merges hits from multiple sources', () => {
    const fts: RetrievalHit[] = [
      { id: 'A', score: 10, source: 'fts' },
      { id: 'B', score: 5, source: 'fts' },
    ];
    const vec: RetrievalHit[] = [
      { id: 'B', score: 0.9, source: 'vector' },
      { id: 'C', score: 0.8, source: 'vector' },
    ];
    expect(reciprocalRankFusion([fts, vec]).length).toBe(3);
  });

  it('ranks by RRF score descending', () => {
    const fts: RetrievalHit[] = [{ id: 'A', score: 10, source: 'fts' }];
    const vec: RetrievalHit[] = [
      { id: 'A', score: 0.9, source: 'vector' },
      { id: 'B', score: 0.5, source: 'vector' },
    ];
    const result = reciprocalRankFusion([fts, vec]);
    expect(result[0].id).toBe('A');
  });

  it('handles empty source groups', () => {
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });

  it('de-duplicates by id', () => {
    const fts: RetrievalHit[] = [{ id: 'X', score: 1, source: 'fts' }];
    const vec: RetrievalHit[] = [{ id: 'X', score: 0.9, source: 'vector' }];
    expect(reciprocalRankFusion([fts, vec])).toHaveLength(1);
  });
});
