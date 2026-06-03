export interface RetrievalHit {
  id: string;
  score: number;
  source: 'fts' | 'vector' | 'sql';
  content?: string;
  metadata?: Record<string, unknown>;
}

const RRF_K = 60;

export function reciprocalRankFusion(hitGroups: RetrievalHit[][]): RetrievalHit[] {
  const idToEntry = new Map<string, { hit: RetrievalHit; rrf: number }>();

  for (const group of hitGroups) {
    const sorted = [...group].sort((a, b) => b.score - a.score);
    sorted.forEach((hit, rank) => {
      const contribution = 1 / (RRF_K + rank + 1);
      const existing = idToEntry.get(hit.id);
      if (existing) {
        existing.rrf += contribution;
        if (!existing.hit.content && hit.content) existing.hit.content = hit.content;
      } else {
        idToEntry.set(hit.id, { hit: { ...hit }, rrf: contribution });
      }
    });
  }

  return Array.from(idToEntry.values())
    .sort((a, b) => b.rrf - a.rrf)
    .map(entry => ({ ...entry.hit, score: Math.round(entry.rrf * 10000) / 10000 }));
}
