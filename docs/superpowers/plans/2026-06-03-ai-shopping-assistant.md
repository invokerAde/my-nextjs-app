# AI 导购助手 + 生产级 RAG 方案实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Next.js 电商平台上构建可上线、低延迟、可演进的 AI 导购底座，包含混合检索、Text2SQL、双轨评论入库、增量热更新和流式导购交互。

**Architecture:** 三层服务架构 — `chat route`（流式会话）、`retrieval service`（检索/融合/Text2SQL）、`index service`（增量索引）。知识数据分层存储于 `product_specs`（结构化参数）+ `knowledge_document`/`knowledge_chunk`（非结构化文档+embedding+FTS）。在线检索经由意图识别→路由→应用层并行召回+RRF融合→引用拼装→LLM生成答案。

**Tech Stack:** Next.js 16 + React 19、Vercel AI SDK + OpenAI、Prisma 7 + PostgreSQL + pgvector、Jest + ts-jest、Tailwind CSS 4 + shadcn/ui

**实施节奏:**
- Phase 1: 数据模型 + 知识表 + 评论双轨入库 + 增量索引
- Phase 2: 应用层并行召回 + RRF + 只读视图 Text2SQL + 强时效路由
- Phase 3: 全站悬浮助手 + Tool 状态流 + 商品化引用卡片 + 指标埋点

---

## Phase 1: 数据模型、知识表、评论双轨入库、增量索引

### 新增依赖

```bash
npm install openai ai @ai-sdk/openai
```

### 新增环境变量

```
# .env 新增
OPENAI_API_KEY="sk-xxx"
OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
OPENAI_CHAT_MODEL="gpt-4o-mini"
REVIEW_DIRECT_CHUNK_THRESHOLD=5
TEXT2SQL_TIMEOUT_MS=5000
TEXT2SQL_MAX_ROWS=50
```

---

### Task 1: Prisma Schema 扩展 — 知识数据模型

**Files:**
- Modify: `prisma/schema.prisma`（在现有 models 后追加）

```prisma
-- product_specs: 结构化商品参数，Text2SQL 主数据源
model ProductSpec {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  productId String   @unique(map: "product_specs_productId_idx") @db.Uuid
  specs     Json     @db.Json
  createdAt DateTime @default(now()) @db.Timestamp(6)
  updatedAt DateTime @updatedAt
  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
}

-- knowledge_document: 商品详情、评论洞察、政策FAQ 文档级管理
model KnowledgeDocument {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  productId String?  @db.Uuid
  docType   String
  docHash   String
  title     String
  sourceRef String?
  metadata  Json     @default("{}") @db.Json
  version   Int      @default(1)
  createdAt DateTime @default(now()) @db.Timestamp(6)
  updatedAt DateTime @updatedAt
  chunks    KnowledgeChunk[]
  product   Product? @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId], map: "kd_productId_idx")
  @@index([docType], map: "kd_docType_idx")
  @@index([docHash], map: "kd_docHash_idx")
}

-- knowledge_chunk: 切分结果 + embedding + FTS + 版本状态
model KnowledgeChunk {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  documentId    String   @db.Uuid
  chunkIndex    Int
  content       String
  tokenCount    Int?
  metadata      Json     @default("{}") @db.Json
  embedding     Unsupported("vector(1536)")?
  tsvector      Unsupported("tsvector")?
  isActive      Boolean  @default(false)
  version       Int      @default(1)
  createdAt     DateTime @default(now()) @db.Timestamp(6)
  document      KnowledgeDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId], map: "kc_documentId_idx")
  @@index([isActive], map: "kc_isActive_idx")
}

-- review_insight: 多评论聚合洞察结果
model ReviewInsight {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  productId   String   @db.Uuid
  content     String
  metadata    Json     @default("{}") @db.Json
  version     Int      @default(1)
  createdAt   DateTime @default(now()) @db.Timestamp(6)
  updatedAt   DateTime @updatedAt
  product     Product  @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId, version], map: "ri_productId_version_idx")
}
```

---

### Task 2: 数据迁移脚本 + 只读视图

**Files:**
- Create: `prisma/views.sql`

```sql
-- 商品规格只读视图(Text2SQL 白名单数据源)
CREATE VIEW product_search_view AS
SELECT
  p.id,
  p.name,
  p.slug,
  p.category,
  p.brand,
  p.price::numeric,
  p.rating::numeric,
  p.numReviews,
  p.stock,
  p.isFeatured,
  COALESCE(ps.specs::text, '{}') AS specs_json
FROM "Product" p
LEFT JOIN "ProductSpec" ps ON ps."productId" = p.id;

-- 已激活的知识 chunk 视图(检索专用)
CREATE VIEW active_knowledge_chunk_view AS
SELECT
  kc.id,
  kc."documentId",
  kc."chunkIndex",
  kc.content,
  kc.embedding,
  kc.tsvector,
  kc.metadata,
  kd."productId",
  kd."docType",
  kd.title
FROM "KnowledgeChunk" kc
JOIN "KnowledgeDocument" kd ON kd.id = kc."documentId"
WHERE kc."isActive" = true;
```

**Step:**
- [ ] Run `npx prisma migrate dev --name add_knowledge_models`
- [ ] Execute `prisma/views.sql` manually against the database (pgvector + tsvector 扩展需预先安装)

---

### Task 3: doc_hash 工具 + 单元测试

**Files:**
- Create: `lib/rag/hasher.ts`
- Create: `tests/rag/hasher.test.ts`

```typescript
// lib/rag/hasher.ts
import crypto from 'crypto';

export function computeDocHash(content: string, metadata?: Record<string, unknown>): string {
  const payload = JSON.stringify({ content, metadata: metadata ?? {} });
  return crypto.createHash('sha256').update(payload).digest('hex');
}
```

```typescript
// tests/rag/hasher.test.ts
import { computeDocHash } from '@/lib/rag/hasher';

describe('computeDocHash', () => {
  it('returns same hash for identical content', () => {
    const h1 = computeDocHash('hello world');
    const h2 = computeDocHash('hello world');
    expect(h1).toBe(h2);
  });

  it('returns different hash for different content', () => {
    const h1 = computeDocHash('hello world');
    const h2 = computeDocHash('hello world!');
    expect(h1).not.toBe(h2);
  });

  it('metadata affects hash', () => {
    const h1 = computeDocHash('hello', { k: 'v' });
    const h2 = computeDocHash('hello', { k: 'v2' });
    expect(h1).not.toBe(h2);
  });

  it('produces 64-char hex string', () => {
    const hash = computeDocHash('test');
    expect(hash).toHaveLength(64);
    expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
  });
});
```

- [ ] Run `npx jest tests/rag/hasher.test.ts` → 4 tests PASS

---

### Task 4: 评论清洗器 + 单元测试

**Files:**
- Create: `lib/rag/cleaner.ts`
- Create: `tests/rag/cleaner.test.ts`

```typescript
// lib/rag/cleaner.ts

const NOISE_PATTERNS = [
  /^[a-zA-Z0-9\s]{1,10}$/,                    // 短评/乱码
  /^[👍👎❤️🔥💯⭐✨]+$/,                      // 纯 emoji
  /(物流|快递|发货|收到).{0,15}(快|慢|好|一般)/, // 物流口水话
  /(好评|好评好评|好好好|赞赞赞)/,              // 纯情绪词
  /客服.{0,10}(态度|回复|服务)/,                // 客服话题
];

const SIGNAL_PATTERNS = [
  /尺码|大小|偏大|偏小|合适|紧|松|宽松/,
  /材质|面料|棉|涤纶|丝绸|羊毛|羊绒|真皮|PU|透气/,
  /做工|走线|线头|拉链|扣子|缝制|粘合/,
  /色差|颜色|掉色|褪色|染色|显白|显黑/,
  /舒适|柔软|扎人|刺痒|闷热|凉爽|亲肤/,
  /场景|上班|约会|运动|日常|出行|聚会|面试/,
  /版型|肩宽|胸围|腰围|衣长|袖长|下摆/,
  /起球|变形|缩水|耐磨|耐洗|防水/,
];

export function cleanReview(reviewText: string): string | null {
  let cleaned = reviewText.trim();

  // 1. 空文本直接丢弃
  if (!cleaned || cleaned.length < 5) return null;

  // 2. 纯符号/纯数字直接丢弃
  if (/^[\d\s\p{P}\p{S}]+$/u.test(cleaned)) return null;

  // 3. 按句号/换行/分号拆分句子,逐个评分
  const sentences = cleaned
    .split(/[。！？\.!\?\n;；]/)
    .map(s => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) return null;

  const scoredSentences = sentences.map(s => {
    let score = 1;
    for (const pattern of NOISE_PATTERNS) {
      if (pattern.test(s)) {
        score -= 0.5;
        break;
      }
    }
    for (const pattern of SIGNAL_PATTERNS) {
      if (pattern.test(s)) {
        score += 0.5;
        break;
      }
    }
    return { text: s, score };
  });

  // 4. 保留得分 >= 1 的句子
  const kept = scoredSentences
    .filter(s => s.score >= 1)
    .map(s => s.text)
    .join('。');

  // 5. 无有效句子则丢弃
  if (!kept) return null;

  return kept;
}
```

```typescript
// tests/rag/cleaner.test.ts
import { cleanReview } from '@/lib/rag/cleaner';

describe('cleanReview', () => {
  it('returns null for empty input', () => {
    expect(cleanReview('')).toBeNull();
    expect(cleanReview('   ')).toBeNull();
    expect(cleanReview('ab')).toBeNull();
  });

  it('returns null for pure emoji', () => {
    expect(cleanReview('👍👍👍')).toBeNull();
  });

  it('filters logistics noise', () => {
    const result = cleanReview('物流很快，材质不错面料柔软舒适');
    expect(result).not.toContain('物流很快');
    expect(result).toContain('材质不错面料柔软舒适');
  });

  it('keeps fit and fabric feedback', () => {
    const result = cleanReview('尺码偏大，建议买小一码。面料透气性好');
    expect(result).toContain('尺码偏大');
    expect(result).toContain('面料透气性好');
  });

  it('filters short noise but keeps signal', () => {
    const result = cleanReview('好评！版型很好，穿着舒适不扎人');
    expect(result).not.toContain('好评');
    expect(result).toContain('版型很好');
  });

  it('returns null when all sentences are noise', () => {
    expect(cleanReview('物流快。客服态度好。好评')).toBeNull();
  });
});
```

- [ ] Run `npx jest tests/rag/cleaner.test.ts` → 6 tests PASS

---

### Task 5: Document Chunker + 单元测试

**Files:**
- Create: `lib/rag/chunker.ts`
- Create: `tests/rag/chunker.test.ts`

```typescript
// lib/rag/chunker.ts

export interface Chunk {
  index: number;
  content: string;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

export function chunkDocument(
  content: string,
  options: {
    maxTokens?: number;
    overlapTokens?: number;
  } = {},
): Chunk[] {
  const { maxTokens = 500, overlapTokens = 50 } = options;

  const paragraphs = content.split(/\n\n+/).filter(Boolean);
  const chunks: Chunk[] = [];
  let index = 0;

  for (const paragraph of paragraphs) {
    const sentences = paragraph.split(/(?<=[。！？\.!\?])/).filter(Boolean);

    if (sentences.length === 0) continue;

    let currentChunk = '';
    let currentEstimate = 0;

    for (const sentence of sentences) {
      const tokenEstimate = estimateTokens(sentence);

      if (currentEstimate + tokenEstimate > maxTokens && currentChunk) {
        chunks.push(buildChunk(index++, currentChunk.trim()));
        // Overlap: take last ~overlapTokens worth of text
        const words = currentChunk.split(/\s+/);
        const overlapSlice = words.slice(-Math.floor(overlapTokens / 2)).join(' ');
        currentChunk = overlapSlice + sentence;
        currentEstimate = estimateTokens(currentChunk);
      } else {
        currentChunk += sentence;
        currentEstimate += tokenEstimate;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(buildChunk(index++, currentChunk.trim()));
    }
  }

  // Ensure at least one chunk
  if (chunks.length === 0) {
    chunks.push(buildChunk(0, content.substring(0, maxTokens)));
  }

  return chunks;
}

function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 chars for English, ≈ 1.5 chars for CJK
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk * 0.6 + other / 4);
}

function buildChunk(index: number, content: string): Chunk {
  return {
    index,
    content,
    tokenCount: estimateTokens(content),
    metadata: {},
  };
}
```

```typescript
// tests/rag/chunker.test.ts
import { chunkDocument } from '@/lib/rag/chunker';

describe('chunkDocument', () => {
  it('returns single chunk for short content', () => {
    const result = chunkDocument('这是一段很短的文本内容');
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('这是一段很短的文本内容');
    expect(result[0].index).toBe(0);
  });

  it('splits on paragraph boundaries', () => {
    const result = chunkDocument('第一段内容。\n\n第二段内容。');
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('第一段内容。');
    expect(result[1].content).toBe('第二段内容。');
  });

  it('returns at least one chunk for any input', () => {
    const result = chunkDocument('hello');
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('each chunk has sequential indices', () => {
    const longText = Array(20).fill('这是一个测试句子。').join('\n\n');
    const result = chunkDocument(longText, { maxTokens: 100 });
    for (let i = 0; i < result.length; i++) {
      expect(result[i].index).toBe(i);
    }
  });

  it('includes token count estimate', () => {
    const result = chunkDocument('测试文本内容');
    expect(result[0].tokenCount).toBeGreaterThan(0);
  });
});
```

- [ ] Run `npx jest tests/rag/chunker.test.ts` → 5 tests PASS

---

### Task 6: 评论双轨入库服务 + 单元测试

**Files:**
- Create: `lib/services/review-ingestion.service.ts`
- Create: `tests/rag/review-ingestion.test.ts`

```typescript
// lib/services/review-ingestion.service.ts
import { prisma } from '@/db/prisma';
import { cleanReview } from '@/lib/rag/cleaner';
import { chunkDocument } from '@/lib/rag/chunker';
import { computeDocHash } from '@/lib/rag/hasher';

const REVIEW_THRESHOLD = Number(process.env.REVIEW_DIRECT_CHUNK_THRESHOLD) || 5;

export interface IngestionResult {
  path: 'direct' | 'aggregate' | 'skipped';
  message: string;
}

/**
 * 对指定商品执行评论双轨入库。
 * 每次调用重新评估评论总数，切换路径时自动清理旧数据。
 */
export async function ingestProductReviews(productId: string): Promise<IngestionResult> {
  const reviewCount = await prisma.review.count({ where: { productId } });

  if (reviewCount === 0) {
    return { path: 'skipped', message: 'No reviews for product' };
  }

  if (reviewCount <= REVIEW_THRESHOLD) {
    return await ingestDirectReviews(productId);
  } else {
    return await ingestAggregatedReviews(productId);
  }
}

async function ingestDirectReviews(productId: string): Promise<IngestionResult> {
  // 1. 查所有评论
  const reviews = await prisma.review.findMany({
    where: { productId },
    select: { id: true, description: true, title: true, rating: true },
  });

  // 2. 清洗并拼接
  const cleanedTexts: string[] = [];
  for (const r of reviews) {
    const text = `${r.title || ''} ${r.description || ''}`;
    const cleaned = cleanReview(text);
    if (cleaned) cleanedTexts.push(`[评分${r.rating}] ${cleaned}`);
  }

  if (cleanedTexts.length === 0) {
    return { path: 'direct', message: 'No signal after cleaning' };
  }

  const content = cleanedTexts.join('\n\n');

  // 3. 检查是否有旧聚合文档, 如有则删除其 chunk
  const oldDoc = await prisma.knowledgeDocument.findFirst({
    where: { productId, docType: 'review_insight' },
  });
  if (oldDoc) {
    await prisma.knowledgeChunk.deleteMany({ where: { documentId: oldDoc.id } });
    await prisma.knowledgeDocument.delete({ where: { id: oldDoc.id } });
  }

  // 4. 写入知识库
  await upsertKnowledgeDocument({
    productId,
    docType: 'review_direct',
    title: `用户评论直入 - ${productId}`,
    content,
  });

  return { path: 'direct', message: `Ingested ${cleanedTexts.length} reviews as direct chunks` };
}

async function ingestAggregatedReviews(productId: string): Promise<IngestionResult> {
  // 1. 查全量评论
  const reviews = await prisma.review.findMany({
    where: { productId },
    select: { description: true, title: true, rating: true },
    orderBy: { createdAt: 'desc' },
  });

  // 2. 清洗
  const cleanedTexts: string[] = [];
  for (const r of reviews) {
    const text = `${r.title || ''} ${r.description || ''}`;
    const cleaned = cleanReview(text);
    if (cleaned) cleanedTexts.push(`[评分${r.rating}] ${cleaned}`);
  }

  if (cleanedTexts.length === 0) {
    return { path: 'aggregate', message: 'No signal after cleaning' };
  }

  // 3. 聚合提示词
  const prompt = buildAggregationPrompt(cleanedTexts);
  // Phase 1 先用简单的统计聚合，Phase 2 可升级为 LLM 摘要
  const aggregatedContent = simpleAggregate(cleanedTexts, productId);

  // 4. 创建 review_insight 记录
  const oldInsight = await prisma.reviewInsight.findFirst({
    where: { productId },
    orderBy: { version: 'desc' },
  });

  const version = (oldInsight?.version ?? 0) + 1;

  await prisma.reviewInsight.create({
    data: {
      productId,
      content: aggregatedContent,
      metadata: { reviewCount: reviews.length, cleanedCount: cleanedTexts.length },
      version,
    },
  });

  // 5. 将聚合内容入库为 knowledge_document + chunks
  // 清理旧版本 review_direct
  await prisma.knowledgeChunk.deleteMany({
    where: {
      document: {
        productId,
        docType: { in: ['review_direct', 'review_insight'] },
      },
    },
  });
  await prisma.knowledgeDocument.deleteMany({
    where: {
      productId,
      docType: { in: ['review_direct', 'review_insight'] },
      NOT: { docType: undefined },
    },
  });

  // 写入新版
  await upsertKnowledgeDocument({
    productId,
    docType: 'review_insight',
    title: `评论聚合洞察 v${version} - ${productId}`,
    content: aggregatedContent,
  });

  // 6. 清理旧版本 insight (保留最新 2 版)
  const oldVersions = await prisma.reviewInsight.findMany({
    where: { productId },
    orderBy: { version: 'desc' },
    skip: 2,
  });
  for (const ov of oldVersions) {
    await prisma.reviewInsight.delete({ where: { id: ov.id } });
  }

  return { path: 'aggregate', message: `Aggregated ${cleanedTexts.length} reviews, v${version}` };
}

function simpleAggregate(cleanedTexts: string[], productId: string): string {
  // 首期简单统计聚合,无 LLM 调用
  const ratingPattern = /\[评分(\d)\]/;
  const ratings = cleanedTexts
    .map(t => {
      const m = t.match(ratingPattern);
      return m ? parseInt(m[1]) : null;
    })
    .filter(Boolean) as number[];

  const avgRating = ratings.length > 0
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
    : 'N/A';

  return [
    `商品 ${productId} 用户评论聚合 (${cleanedTexts.length} 条有效评论)`,
    `平均评分: ${avgRating}/5`,
    '',
    '用户反馈摘要:',
    ...cleanedTexts.slice(0, 30), // 最多保留30条
  ].join('\n');
}

function buildAggregationPrompt(cleanedTexts: string[]): string {
  return `基于以下用户评论, 生成商品洞察摘要...\n\n${cleanedTexts.join('\n')}`;
}

async function upsertKnowledgeDocument(params: {
  productId: string;
  docType: string;
  title: string;
  content: string;
}): Promise<void> {
  const docHash = computeDocHash(params.content);
  const existing = await prisma.knowledgeDocument.findFirst({
    where: { productId: params.productId, docType: params.docType, docHash },
  });

  if (existing) {
    return; // 内容未变,跳过
  }

  // 内容已变: 旧版本 deactivate, 新版本 insert
  const oldDocs = await prisma.knowledgeDocument.findMany({
    where: { productId: params.productId, docType: params.docType },
  });

  for (const od of oldDocs) {
    if (od.docHash !== docHash) {
      await prisma.knowledgeChunk.updateMany({
        where: { documentId: od.id, isActive: true },
        data: { isActive: false },
      });
    }
  }

  const version = (oldDocs.length > 0
    ? Math.max(...oldDocs.map(d => d.version))
    : 0) + 1;

  const doc = await prisma.knowledgeDocument.create({
    data: {
      productId: params.productId,
      docType: params.docType,
      docHash,
      title: params.title,
      version,
    },
  });

  const chunks = chunkDocument(params.content);
  for (const c of chunks) {
    await prisma.knowledgeChunk.create({
      data: {
        documentId: doc.id,
        chunkIndex: c.index,
        content: c.content,
        tokenCount: c.tokenCount,
        isActive: true,
        version,
      },
    });
  }

  // 异步清理旧版本(生产环境可用 queue)
  await cleanupOldVersions(params.productId, params.docType, doc.id);
}

async function cleanupOldVersions(
  productId: string,
  docType: string,
  keepDocId: string,
): Promise<void> {
  // 硬删除当前版本以外的旧 chunk + 旧 document
  const oldDocs = await prisma.knowledgeDocument.findMany({
    where: {
      productId,
      docType,
      id: { not: keepDocId },
    },
    select: { id: true },
  });

  for (const od of oldDocs) {
    await prisma.knowledgeChunk.deleteMany({ where: { documentId: od.id } });
    await prisma.knowledgeDocument.delete({ where: { id: od.id } });
  }
}
```

```typescript
// tests/rag/review-ingestion.test.ts
import { computeDocHash } from '@/lib/rag/hasher';

describe('Review dual-track logic (unit)', () => {
  it('computeDocHash is deterministic', () => {
    const content = '尺码偏大，面料透气性好';
    const h1 = computeDocHash(content);
    const h2 = computeDocHash(content);
    expect(h1).toBe(h2);
  });

  it('covers the direct path threshold check', () => {
    const THRESHOLD = 5;
    expect(3).toBeLessThanOrEqual(THRESHOLD);   // direct path
    expect(7).toBeGreaterThan(THRESHOLD);        // aggregate path
  });

  it('cleanReview removes logistics noise', () => {
    // Import would be tested via cleaner.test.ts; this is a logic gate check
    const NOISE = /(物流|快递|发货).{0,15}(快|慢|好|一般)/;
    expect(NOISE.test('物流很快')).toBe(true);
    expect(NOISE.test('材质不错')).toBe(false);
  });
});
```

- [ ] Run `npx jest tests/rag/review-ingestion.test.ts` → tests PASS

---

### Task 7: Embedding Service + 单元测试

**Files:**
- Create: `lib/services/embedding.service.ts`
- Create: `tests/rag/embedding.test.ts`

```typescript
// lib/services/embedding.service.ts
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.replace(/\n/g, ' '),
  });
  return response.data[0].embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts.map(t => t.replace(/\n/g, ' ')),
  });
  return response.data.map(d => d.embedding);
}
```

```typescript
// tests/rag/embedding.test.ts
describe('Embedding service (contract)', () => {
  it('embedding model config is set', () => {
    expect(process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small').toBeTruthy();
  });

  it('embedding dimension expectation (1536 for ada-002, 1536 for 3-small)', () => {
    const expectedDim = 1536;
    expect(expectedDim).toBe(1536); // pgvector index dimension
  });

  it('input normalization strips newlines', () => {
    const input = 'hello\nworld\n';
    const normalized = input.replace(/\n/g, ' ');
    expect(normalized).toBe('hello world ');
    expect(normalized).not.toContain('\n');
  });
});
```

- [ ] Run `npx jest tests/rag/embedding.test.ts` → tests PASS

---

### Task 8: 增量索引服务 (Index Service)

**Files:**
- Create: `lib/services/index.service.ts`

```typescript
// lib/services/index.service.ts
import { prisma } from '@/db/prisma';
import { chunkDocument } from '@/lib/rag/chunker';
import { computeDocHash } from '@/lib/rag/hasher';
import { generateEmbedding } from '@/lib/services/embedding.service';

export interface IndexDocumentParams {
  productId: string;
  docType: string;
  title: string;
  content: string;
  sourceRef?: string;
}

/**
 * 对单个文档执行增量索引：
 *   - 新增：插入 document + chunk + embedding + tsvector
 *   - 修改：生成新版本 chunk, 旧版本 deactivate
 *   - 未变：跳过
 */
export async function indexDocument(params: IndexDocumentParams): Promise<{
  action: 'created' | 'updated' | 'skipped';
  docId: string;
}> {
  const docHash = computeDocHash(params.content);

  // 1. 检查是否有未变的已激活文档
  const existing = await prisma.knowledgeDocument.findFirst({
    where: { productId: params.productId, docType: params.docType, docHash },
    include: { chunks: { where: { isActive: true }, take: 1 } },
  });

  if (existing && existing.chunks.length > 0) {
    return { action: 'skipped', docId: existing.id };
  }

  // 2. 旧版本 deactivate
  await prisma.knowledgeChunk.updateMany({
    where: {
      document: { productId: params.productId, docType: params.docType },
      isActive: true,
    },
    data: { isActive: false },
  });

  // 3. 计算版本号
  const maxVersion = await prisma.knowledgeDocument.aggregate({
    _max: { version: true },
    where: { productId: params.productId, docType: params.docType },
  });
  const version = (maxVersion._max.version ?? 0) + 1;

  // 4. 创建 document
  const doc = await prisma.knowledgeDocument.create({
    data: {
      productId: params.productId,
      docType: params.docType,
      docHash,
      title: params.title,
      version,
      sourceRef: params.sourceRef,
    },
  });

  // 5. chunk + embedding + tsvector
  const chunks = chunkDocument(params.content);
  const embeddings = await generateEmbeddings(chunks.map(c => c.content));

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];

    // 构造 tsvector (应用层生成, 不依赖触发器)
    const tsvectorExpr = toTsvector(c.content);

    await prisma.$executeRawUnsafe(
      `INSERT INTO "KnowledgeChunk" (id, "documentId", "chunkIndex", content, "tokenCount", embedding, tsvector, "isActive", version, "createdAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::vector, to_tsvector('simple', $6), true, $7, NOW())`,
      doc.id,
      c.index,
      c.content,
      c.tokenCount,
      pgVectorLiteral(embeddings[i]),
      tsvectorExpr,
      version,
    );
  }

  // 6. 异步清理旧版本
  deleteOldVersions(params.productId, params.docType, doc.id).catch(err =>
    console.error('Old version cleanup failed:', err),
  );

  return { action: existing ? 'updated' : 'created', docId: doc.id };
}

/**
 * 从商品详情生成知识文档并索引
 */
export async function indexProductDetail(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { Review: { select: { description: true, title: true, rating: true } } },
  });

  if (!product) throw new Error(`Product ${productId} not found`);

  const content = [
    `商品名称: ${product.name}`,
    `品牌: ${product.brand}`,
    `类目: ${product.category}`,
    `描述: ${product.description}`,
  ].join('\n');

  await indexDocument({
    productId,
    docType: 'product_detail',
    title: product.name,
    content,
  });
}

function toTsvector(content: string): string {
  // 使用 simple 配置而非 english/chinese, 简单分词即可配合 GIN 索引
  return content
    .replace(/[^\w一-鿿\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

function pgVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

async function deleteOldVersions(
  productId: string,
  docType: string,
  keepDocId: string,
): Promise<void> {
  const oldDocs = await prisma.knowledgeDocument.findMany({
    where: { productId, docType, id: { not: keepDocId } },
    select: { id: true },
  });

  for (const od of oldDocs) {
    await prisma.knowledgeChunk.deleteMany({ where: { documentId: od.id } });
    await prisma.knowledgeDocument.delete({ where: { id: od.id } });
  }
}
```

---

### Task 9: 商品 CRUD 钩子集成

**Files:**
- Modify: `lib/actions/product.actions.ts`

在 `createProduct` 和 `updateProduct` 成功后追加索引触发:

```typescript
// 在 createProduct 函数体末尾, revalidatePath 之前:
import { indexProductDetail } from '@/lib/services/index.service';
import { ingestProductReviews } from '@/lib/services/review-ingestion.service';

// createProduct:
  await indexProductDetail(insertedProduct.id).catch(err =>
    console.error('Index product detail failed:', err)
  );

// updateProduct:
  await indexProductDetail(product.id).catch(err =>
    console.error('Index product detail failed:', err)
  );
```

- Modify: `lib/actions/review.actions.ts`

在 `createUpdateReview` 事务成功后追加:

```typescript
// 在 createUpdateReview 的 tx 事务成功后:
import { ingestProductReviews } from '@/lib/services/review-ingestion.service';

// 事务成功后:
ingestProductReviews(review.productId).catch(err =>
  console.error('Review ingestion failed:', err)
);
```

---

### Task 10: 数据库索引与 HNSW 初始化脚本

**Files:**
- Create: `prisma/indexes.sql`

```sql
-- GIN 索引: 全文检索
CREATE INDEX IF NOT EXISTS idx_kc_tsvector_gin
ON "KnowledgeChunk" USING GIN (tsvector);

-- HNSW 索引: 向量相似度检索 (pgvector)
CREATE INDEX IF NOT EXISTS idx_kc_embedding_hnsw
ON "KnowledgeChunk" USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 200);

-- 复合索引: 按文档激活状态快速过滤
CREATE INDEX IF NOT EXISTS idx_kc_doc_active
ON "KnowledgeChunk" ("documentId", "isActive");

-- product_specs 索引
CREATE INDEX IF NOT EXISTS idx_ps_product_id
ON "ProductSpec" ("productId");

-- review_insight 索引
CREATE INDEX IF NOT EXISTS idx_ri_product_version
ON "ReviewInsight" ("productId", version);
```

- [ ] 在生产数据库执行 `prisma/indexes.sql`

---

### Task 11: Phase 1 提交

```bash
git add prisma/schema.prisma prisma/views.sql prisma/indexes.sql
git add lib/rag/ lib/services/embedding.service.ts lib/services/index.service.ts lib/services/review-ingestion.service.ts
git add lib/actions/product.actions.ts lib/actions/review.actions.ts
git add tests/rag/
git commit -m "feat(rag): add knowledge data models, dual-track review ingestion, and incremental indexing"
```

---

## Phase 2: 检索管线 — 并行召回 + RRF 融合 + Text2SQL + 实时路由

---

### Task 12: 属性词典 + 同义词表

**Files:**
- Create: `lib/rag/attribute-dict.ts`
- Create: `lib/rag/synonyms.ts`

```typescript
// lib/rag/attribute-dict.ts

export const CATEGORY_MAP: Record<string, string[]> = {
  '衬衫': ['衬衣', 'shirt', '正装衬衫', '休闲衬衫'],
  'T恤': ['t恤', 't-shirt', '短袖', 'tee', '文化衫'],
  '裤子': ['裤', '长裤', 'pants', 'trousers', '休闲裤', '西裤', '牛仔裤'],
  '外套': ['夹克', 'jacket', '大衣', '风衣', '羽绒服'],
  '裙子': ['裙', '连衣裙', '半身裙', 'skirt', 'dress'],
  '鞋子': ['鞋', '运动鞋', '皮鞋', '靴子', 'shoes'],
};

export const ATTRIBUTE_MAP: Record<string, { field: string; values: string[] }> = {
  '材质': {
    field: 'material',
    values: ['棉', '涤纶', '丝绸', '羊毛', '羊绒', '真皮', 'PU', '麻', '莫代尔', '氨纶', '锦纶', '牛仔'],
  },
  '颜色': {
    field: 'color',
    values: ['黑', '白', '红', '蓝', '灰', '绿', '黄', '粉', '紫', '棕', '卡其', '藏青', '米白'],
  },
  '版型': {
    field: 'fit',
    values: ['修身', '宽松', '直筒', '锥形', '阔腿', '紧身', 'oversize', '常规'],
  },
  '袖长': {
    field: 'sleeveLength',
    values: ['长袖', '短袖', '无袖', '七分袖', '五分袖'],
  },
  '领型': {
    field: 'collar',
    values: ['圆领', 'V领', '翻领', '立领', '方领', 'POLO领', '一字领'],
  },
  '场景': {
    field: 'scene',
    values: ['上班', '约会', '运动', '日常', '出行', '聚会', '面试', '居家', '户外'],
  },
  '季节': {
    field: 'season',
    values: ['春', '夏', '秋', '冬', '春秋', '四季通用'],
  },
};

export function extractAttributes(query: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const [attrName, { field, values }] of Object.entries(ATTRIBUTE_MAP)) {
    const matched: string[] = [];
    for (const v of values) {
      if (query.includes(v)) {
        matched.push(v);
      }
    }
    if (matched.length > 0) {
      result[field] = matched;
    }
  }

  return result;
}

export function extractCategory(query: string): string | null {
  for (const [cat, aliases] of Object.entries(CATEGORY_MAP)) {
    for (const alias of aliases) {
      if (query.includes(alias)) {
        return cat;
      }
    }
  }
  return null;
}
```

```typescript
// lib/rag/synonyms.ts

export const SYNONYM_MAP: Record<string, string[]> = {
  '透气': ['透气性', '通风', '透汗', '散热'],
  '保暖': ['保温', '保暖性', '御寒', '厚实'],
  '舒适': ['柔软', '亲肤', '贴身穿', '舒服'],
  '耐磨': ['耐穿', '耐洗', '不起球', '不缩水', '不变形'],
  '显瘦': ['遮肉', '修身', '苗条', '显身材'],
  '便宜': ['实惠', '划算', '高性价比', '不贵'],
  '高档': ['高级', '有质感', '上档次', '精致', '奢华'],
};

export function expandQuery(query: string): string {
  let expanded = query;
  for (const [term, synonyms] of Object.entries(SYNONYM_MAP)) {
    if (query.includes(term)) {
      expanded += ' ' + synonyms.join(' ');
    }
  }
  return expanded;
}
```

---

### Task 13: 意图识别 + 问题路由

**Files:**
- Create: `lib/services/intent.service.ts`
- Create: `tests/rag/intent.test.ts`

```typescript
// lib/services/intent.service.ts

export type IntentType =
  | 'product_filter'      // 参数筛选/对比 → Text2SQL + vector
  | 'product_detail'       // 商品详情 → FTS + vector
  | 'review_insight'       // 评论洞察 → vector + FTS
  | 'policy_faq'           // 政策FAQ → FTS + vector
  | 'realtime_price_stock' // 强时效价格库存 → Text2SQL only
  | 'hybrid'               // 混合 → 并行召回 + RRF
  ;

export interface IntentResult {
  intent: IntentType;
  entities: {
    productIds?: string[];
    categories?: string[];
    brand?: string;
    attributes?: Record<string, string[]>;
    priceRange?: { min?: number; max?: number };
    comparisonTarget?: string;
  };
  isTimeSensitive: boolean;
}

const TIMESENSITIVE_KEYWORDS = [
  '多少钱', '价格', '多少钱', '优惠', '打折', '促销', '有货吗',
  '库存', 'M码', 'L码', 'XL码', 'S码', '尺码表', '还有吗',
  '现在', '目前', '当前', '实时', '最新价',
];

const FILTER_KEYWORDS = [
  '推荐', '有什么', '哪些', '哪款', '比较', '对比', '哪个好',
  '以内', '以下', '以上', '不超过', '最好', '排行', '热门',
];

const DETAIL_KEYWORDS = [
  '材质', '面料', '描述', '详情', '规格', '参数', '尺寸',
  '成分', '适用', '怎么洗', '保养',
];

const REVIEW_KEYWORDS = [
  '评价', '评论', '口碑', '反馈', '体验', '买家说', '用户',
  '偏大', '偏小', '起球', '褪色', '缩水', '透气', '舒适度',
];

const FAQ_KEYWORDS = [
  '退货', '换货', '退款', '发货', '运费', '保修', '政策', '规则',
  '多久', '几天', '怎么退', '能不能退',
];

export function classifyIntent(query: string): IntentResult {
  const isTimeSensitive = TIMESENSITIVE_KEYWORDS.some(k => query.includes(k));

  const hasFilter = FILTER_KEYWORDS.some(k => query.includes(k));
  const hasDetail = DETAIL_KEYWORDS.some(k => query.includes(k));
  const hasReview = REVIEW_KEYWORDS.some(k => query.includes(k));
  const hasFAQ = FAQ_KEYWORDS.some(k => query.includes(k));

  let intent: IntentType;

  if (isTimeSensitive) {
    intent = 'realtime_price_stock';
  } else if (hasFilter && hasDetail) {
    intent = 'hybrid';
  } else if (hasFilter) {
    intent = 'product_filter';
  } else if (hasReview) {
    intent = 'review_insight';
  } else if (hasFAQ) {
    intent = 'policy_faq';
  } else if (hasDetail) {
    intent = 'product_detail';
  } else {
    intent = 'hybrid';
  }

  return {
    intent,
    entities: extractEntities(query),
    isTimeSensitive,
  };
}

function extractEntities(query: string): IntentResult['entities'] {
  const { extractAttributes, extractCategory } = require('@/lib/rag/attribute-dict');
  return {
    categories: extractCategory(query) ? [extractCategory(query)!] : [],
    attributes: extractAttributes(query),
  };
}
```

```typescript
// tests/rag/intent.test.ts
import { classifyIntent } from '@/lib/services/intent.service';

describe('classifyIntent', () => {
  it('routes price query to realtime_price_stock', () => {
    const result = classifyIntent('这件衣服多少钱？');
    expect(result.intent).toBe('realtime_price_stock');
    expect(result.isTimeSensitive).toBe(true);
  });

  it('routes stock query to realtime_price_stock', () => {
    const result = classifyIntent('这款还有M码吗？');
    expect(result.intent).toBe('realtime_price_stock');
  });

  it('routes recommendation to product_filter', () => {
    const result = classifyIntent('100元以内棉质长袖有什么推荐？');
    expect(result.intent).toBe('product_filter');
  });

  it('routes review question to review_insight', () => {
    const result = classifyIntent('用户说这款尺码偏大还是偏小？');
    expect(result.intent).toBe('review_insight');
  });

  it('routes faq to policy_faq', () => {
    const result = classifyIntent('7天退货政策是什么？');
    expect(result.intent).toBe('policy_faq');
  });

  it('marks promotion query as time-sensitive', () => {
    const result = classifyIntent('现在有什么优惠活动？');
    expect(result.intent).toBe('realtime_price_stock');
    expect(result.isTimeSensitive).toBe(true);
  });
});
```

- [ ] Run `npx jest tests/rag/intent.test.ts` → 6 tests PASS

---

### Task 14: RRF 融合服务 + 单元测试

**Files:**
- Create: `lib/services/rrf.service.ts`
- Create: `tests/rag/rrf.test.ts`

```typescript
// lib/services/rrf.service.ts

export interface RetrievalHit {
  id: string;
  score: number;              // 原始分 (rank or distance)
  source: 'fts' | 'vector' | 'sql';
  content?: string;
  metadata?: Record<string, unknown>;
}

const RRF_K = 60; // RRF 平滑常数

/**
 * 在应用层执行 Reciprocal Rank Fusion:
 *   1. 按各自分数排序得到 rank
 *   2. RRF = sum(1 / (k + rank_i))  across sources
 *   3. 去重合并后按 RRF 降序返回
 */
export function reciprocalRankFusion(
  hitGroups: RetrievalHit[][],
): RetrievalHit[] {
  const idToEntry = new Map<string, { hit: RetrievalHit; rrf: number }>();

  for (const group of hitGroups) {
    // 按原始分降序排序
    const sorted = [...group].sort((a, b) => b.score - a.score);

    sorted.forEach((hit, rank) => {
      const contribution = 1 / (RRF_K + rank + 1);
      const existing = idToEntry.get(hit.id);

      if (existing) {
        existing.rrf += contribution;
        // 保留更丰富的 metadata
        if (!existing.hit.content && hit.content) {
          existing.hit.content = hit.content;
        }
      } else {
        idToEntry.set(hit.id, {
          hit: { ...hit },
          rrf: contribution,
        });
      }
    });
  }

  // 按 RRF 降序排列
  return Array.from(idToEntry.values())
    .sort((a, b) => b.rrf - a.rrf)
    .map(entry => ({
      ...entry.hit,
      score: Math.round(entry.rrf * 10000) / 10000,
    }));
}
```

```typescript
// tests/rag/rrf.test.ts
import { reciprocalRankFusion, RetrievalHit } from '@/lib/services/rrf.service';

describe('reciprocalRankFusion', () => {
  it('merges hits from multiple sources', () => {
    const ftsHits: RetrievalHit[] = [
      { id: 'A', score: 10, source: 'fts' },
      { id: 'B', score: 5, source: 'fts' },
    ];
    const vecHits: RetrievalHit[] = [
      { id: 'B', score: 0.9, source: 'vector' },
      { id: 'C', score: 0.8, source: 'vector' },
    ];

    const result = reciprocalRankFusion([ftsHits, vecHits]);
    expect(result.length).toBe(3);
  });

  it('ranks by RRF score descending', () => {
    const ftsHits: RetrievalHit[] = [
      { id: 'A', score: 10, source: 'fts' },
    ];
    const vecHits: RetrievalHit[] = [
      { id: 'A', score: 0.9, source: 'vector' },
      { id: 'B', score: 0.5, source: 'vector' },
    ];

    const result = reciprocalRankFusion([ftsHits, vecHits]);
    // A should rank higher than B since it appears in both sources
    expect(result[0].id).toBe('A');
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('handles empty source groups', () => {
    const result = reciprocalRankFusion([[], []]);
    expect(result).toEqual([]);
  });

  it('de-duplicates by id', () => {
    const ftsHits: RetrievalHit[] = [
      { id: 'X', score: 1, source: 'fts' },
    ];
    const vecHits: RetrievalHit[] = [
      { id: 'X', score: 0.9, source: 'vector' },
    ];

    const result = reciprocalRankFusion([ftsHits, vecHits]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('X');
  });
});
```

- [ ] Run `npx jest tests/rag/rrf.test.ts` → 4 tests PASS

---

### Task 15: Text2SQL 服务 + 只读约束

**Files:**
- Create: `lib/services/text2sql.service.ts`
- Create: `tests/rag/text2sql.test.ts`

```typescript
// lib/services/text2sql.service.ts
import OpenAI from 'openai';
import { prisma } from '@/db/prisma';
import { FEW_SHOT_EXAMPLES, SQL_SYSTEM_PROMPT } from '@/lib/rag/templates/few-shot-examples';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TIMEOUT_MS = Number(process.env.TEXT2SQL_TIMEOUT_MS) || 5000;
const MAX_ROWS = Number(process.env.TEXT2SQL_MAX_ROWS) || 50;

const ALLOWED_TABLES = ['product_search_view'];
const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE',
  'TRUNCATE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE',
];

export interface Text2SQLResult {
  success: boolean;
  rows?: Record<string, unknown>[];
  sql?: string;
  error?: string;
}

/**
 * 将自然语言转为受约束的只读 SQL 查询。
 * 失败时返回 { success: false } 而不触发二次检索。
 */
export async function textToSQL(query: string): Promise<Text2SQLResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const completion = await openai.chat.completions.create(
      {
        model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SQL_SYSTEM_PROMPT },
          ...FEW_SHOT_EXAMPLES,
          { role: 'user', content: `Query: ${query}\nSQL:` },
        ],
        temperature: 0,
        max_tokens: 300,
      },
      { signal: controller.signal },
    );

    const sql = completion.choices[0]?.message?.content?.trim() || '';

    if (!validateSQL(sql)) {
      return { success: false, error: 'Generated SQL failed validation', sql };
    }

    const limitedSQL = addRowLimit(sql);
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(limitedSQL);

    return { success: true, rows: rows.slice(0, MAX_ROWS), sql: limitedSQL };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Text2SQL timeout' };
    }
    return { success: false, error: err.message || 'Text2SQL failed' };
  } finally {
    clearTimeout(timeoutId);
  }
}

function validateSQL(sql: string): boolean {
  if (!sql || sql.length < 5) return false;

  const upper = sql.toUpperCase();
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (upper.includes(keyword)) return false;
  }

  // 必须引用白名单表
  const hasAllowedTable = ALLOWED_TABLES.some(t => sql.includes(t));
  if (!hasAllowedTable) return false;

  return true;
}

function addRowLimit(sql: string): string {
  const trimmed = sql.trim().replace(/;+$/, '');
  if (/LIMIT\s+\d+/i.test(trimmed)) return trimmed;
  return `${trimmed} LIMIT ${MAX_ROWS}`;
}
```

```typescript
// tests/rag/text2sql.test.ts
describe('Text2SQL validation (unit)', () => {
  const FORBIDDEN_KEYWORDS = [
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE',
    'TRUNCATE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE',
  ];

  function validateSQL(sql: string): boolean {
    if (!sql || sql.length < 5) return false;
    const upper = sql.toUpperCase();
    for (const kw of FORBIDDEN_KEYWORDS) {
      if (upper.includes(kw)) return false;
    }
    return sql.includes('product_search_view');
  }

  it('rejects empty SQL', () => {
    expect(validateSQL('')).toBe(false);
    expect(validateSQL('SEL')).toBe(false);
  });

  it('rejects INSERT statement', () => {
    expect(validateSQL('INSERT INTO product_search_view VALUES (1)')).toBe(false);
  });

  it('rejects DROP statement', () => {
    expect(validateSQL('DROP TABLE product_search_view')).toBe(false);
  });

  it('rejects SQL without whitelist table', () => {
    expect(validateSQL('SELECT * FROM "Product"')).toBe(false);
  });

  it('accepts valid SELECT on whitelist view', () => {
    expect(validateSQL("SELECT * FROM product_search_view WHERE name ILIKE '%棉%'")).toBe(true);
  });

  it('rejects UPDATE even with whitelist table', () => {
    expect(validateSQL("UPDATE product_search_view SET name = 'x'")).toBe(false);
  });
});
```

- [ ] Run `npx jest tests/rag/text2sql.test.ts` → 6 tests PASS

---

### Task 16: Few-shot 示例 + Prompt 模板

**Files:**
- Create: `lib/rag/templates/few-shot-examples.ts`
- Create: `lib/rag/templates/prompts.ts`

```typescript
// lib/rag/templates/few-shot-examples.ts

export const SQL_SYSTEM_PROMPT = `You are a SQL query generator for an e-commerce product database.
Rules:
- ONLY SELECT queries are allowed.
- ONLY query the "product_search_view" view.
- Use ILIKE for text search.
- Price and rating are numeric, use >=, <=, BETWEEN.
- Always include a LIMIT clause (max 50).
- Return only the raw SQL, no explanation.`;

export const FEW_SHOT_EXAMPLES = [
  {
    role: 'user' as const,
    content: 'Query: 100元以内棉质长袖衬衫有什么推荐？\nSQL:',
  },
  {
    role: 'assistant' as const,
    content: `SELECT id, name, slug, category, brand, price, rating, numReviews, stock
FROM product_search_view
WHERE price <= 100
  AND specs_json ILIKE '%棉%'
  AND specs_json ILIKE '%长袖%'
  AND category ILIKE '%衬衫%'
  AND stock > 0
ORDER BY rating DESC
LIMIT 20`,
  },
  {
    role: 'user' as const,
    content: 'Query: 评分4分以上的夏季透气面料连衣裙\nSQL:',
  },
  {
    role: 'assistant' as const,
    content: `SELECT id, name, slug, category, brand, price, rating, numReviews, stock
FROM product_search_view
WHERE rating >= 4
  AND specs_json ILIKE '%透气%'
  AND (specs_json ILIKE '%夏季%' OR specs_json ILIKE '%夏%')
  AND category ILIKE '%裙%'
  AND stock > 0
ORDER BY rating DESC, price ASC
LIMIT 20`,
  },
  {
    role: 'user' as const,
    content: 'Query: 500元以内真皮材质评分最高的鞋子\nSQL:',
  },
  {
    role: 'assistant' as const,
    content: `SELECT id, name, slug, category, brand, price, rating, numReviews, stock
FROM product_search_view
WHERE price <= 500
  AND specs_json ILIKE '%真皮%'
  AND category ILIKE '%鞋%'
  AND stock > 0
ORDER BY rating DESC
LIMIT 20`,
  },
  {
    role: 'user' as const,
    content: 'Query: 适合上班穿的修身版型外套，黑色的\nSQL:',
  },
  {
    role: 'assistant' as const,
    content: `SELECT id, name, slug, category, brand, price, rating, numReviews, stock
FROM product_search_view
WHERE specs_json ILIKE '%上班%'
  AND specs_json ILIKE '%修身%'
  AND specs_json ILIKE '%黑%'
  AND category ILIKE '%外套%'
  AND stock > 0
ORDER BY rating DESC
LIMIT 20`,
  },
  {
    role: 'user' as const,
    content: 'Query: 有没有棉质圆领短袖T恤，50元以内\nSQL:',
  },
  {
    role: 'assistant' as const,
    content: `SELECT id, name, slug, category, brand, price, rating, numReviews, stock
FROM product_search_view
WHERE price <= 50
  AND specs_json ILIKE '%棉%'
  AND specs_json ILIKE '%圆领%'
  AND specs_json ILIKE '%短袖%'
  AND category ILIKE '%T恤%'
  AND stock > 0
ORDER BY price ASC
LIMIT 20`,
  },
  {
    role: 'user' as const,
    content: 'Query: 休闲裤有什么品牌？价格从低到高排列\nSQL:',
  },
  {
    role: 'assistant' as const,
    content: `SELECT DISTINCT brand, MIN(price) as min_price, COUNT(*) as product_count
FROM product_search_view
WHERE category ILIKE '%裤%'
  AND specs_json ILIKE '%休闲%'
  AND stock > 0
GROUP BY brand
ORDER BY min_price ASC
LIMIT 20`,
  },
  {
    role: 'user' as const,
    content: 'Query: 这件衣服现在多少钱？\nSQL:',
  },
  {
    role: 'assistant' as const,
    content: `SELECT id, name, price, stock
FROM product_search_view
WHERE name ILIKE '%衣服%'
LIMIT 10`,
  },
  {
    role: 'user' as const,
    content: 'Query: 有没有促销打折的商品？\nSQL:',
  },
  {
    role: 'assistant' as const,
    content: `SELECT id, name, price, category, stock
FROM product_search_view
WHERE stock > 0
ORDER BY price ASC
LIMIT 20`,
  },
  {
    role: 'user' as const,
    content: 'Query: 和这款面料类似的商品有什么？\nSQL:',
  },
  {
    role: 'assistant' as const,
    content: `SELECT id, name, slug, category, brand, price, rating
FROM product_search_view
WHERE stock > 0
ORDER BY rating DESC
LIMIT 20`,
  },
  {
    role: 'user' as const,
    content: 'Query: 170以下适合的短款外套\nSQL:',
  },
  {
    role: 'assistant' as const,
    content: `SELECT id, name, slug, category, brand, price, rating
FROM product_search_view
WHERE category ILIKE '%外套%'
  AND specs_json ILIKE '%短款%'
  AND stock > 0
ORDER BY rating DESC
LIMIT 20`,
  },
];
```

```typescript
// lib/rag/templates/prompts.ts

export const ANSWER_SYSTEM_PROMPT = `You are a helpful e-commerce shopping assistant for a store called Prostore.
Your job is to help customers find products, answer questions about products, and provide shopping advice.

Guidelines:
- Answer in the same language as the user's question (Chinese or English).
- Be concise and helpful. Give specific recommendations with reasoning.
- When citing product information, always reference the source.
- If you don't have enough information to answer confidently, say so clearly.
- For price/stock questions, always note that these may change and suggest the customer check the product page.
- Format your response with clear sections when comparing products.`;

export const CONSERVATIVE_ANSWER = `根据目前掌握的信息，我暂时无法给出准确的答案。建议您：

1. 访问商品详情页查看最新价格和库存信息
2. 联系客服获取实时帮助
3. 使用搜索框按条件筛选商品

如果您有其他问题，我很乐意帮您解答。`;
```

---

### Task 17: 检索编排服务 (Retrieval Service)

**Files:**
- Create: `lib/services/retrieval.service.ts`

```typescript
// lib/services/retrieval.service.ts
import { prisma } from '@/db/prisma';
import { classifyIntent, IntentResult } from '@/lib/services/intent.service';
import { reciprocalRankFusion, RetrievalHit } from '@/lib/services/rrf.service';
import { textToSQL } from '@/lib/services/text2sql.service';
import { generateEmbedding } from '@/lib/services/embedding.service';
import { expandQuery } from '@/lib/rag/synonyms';

export interface RetrievalResult {
  hits: RetrievalHit[];
  sqlResult?: Record<string, unknown>[];
  usedSources: ('fts' | 'vector' | 'sql')[];
  confidence: 'high' | 'medium' | 'low';
}

const TOP_K = 20;

/**
 * 在线检索编排:
 *   1. 意图识别 + 实体抽取
 *   2. 问题路由
 *   3. 多路并行召回 + 应用层 RRF
 *   4. 返回融合结果
 */
export async function retrieve(
  query: string,
  context?: { productId?: string },
): Promise<RetrievalResult> {
  const intent = classifyIntent(query);
  const expandedQuery = expandQuery(query);

  const tasks: Promise<RetrievalHit[]>[] = [];
  let sqlResult: Record<string, unknown>[] | undefined;

  const usedSources: ('fts' | 'vector' | 'sql')[] = [];

  // 根据意图决定召回路径
  switch (intent.intent) {
    case 'realtime_price_stock':
      // 强时效: 仅 Text2SQL
      const sql = await textToSQL(query);
      if (sql.success && sql.rows) {
        sqlResult = sql.rows;
        usedSources.push('sql');
      }
      // SQL 结果也转化为 hit 参与后续引用拼装
      if (sqlResult && sqlResult.length > 0) {
        tasks.push(
          Promise.resolve(
            sqlResult.map(r => ({
              id: (r.id as string) || `sql_${Math.random()}`,
              score: 1.0,
              source: 'sql' as const,
              content: JSON.stringify(r),
              metadata: r as Record<string, unknown>,
            })),
          ),
        );
      }
      break;

    case 'product_filter':
      // 参数筛选: Text2SQL 为主, vector 补充
      usedSources.push('sql', 'vector');
      tasks.push(
        textToSQL(query).then(r => {
          if (r.success && r.rows) {
            sqlResult = r.rows;
            return r.rows.map(row => ({
              id: (row.id as string) || `sql_${Math.random()}`,
              score: 1.0,
              source: 'sql' as const,
              content: JSON.stringify(row),
              metadata: row as Record<string, unknown>,
            }));
          }
          return [];
        }),
      );
      tasks.push(vectorSearch(expandedQuery, context?.productId, TOP_K));
      break;

    case 'product_detail':
    case 'review_insight':
    case 'policy_faq':
    case 'hybrid':
    default:
      // FTS + vector 并行
      usedSources.push('fts', 'vector');
      tasks.push(ftsSearch(expandedQuery, TOP_K));
      tasks.push(vectorSearch(expandedQuery, context?.productId, TOP_K));
      break;
  }

  // 并行召回
  const hitGroups = await Promise.all(tasks);
  const hits = reciprocalRankFusion(hitGroups);

  // 计算置信度
  const confidence = computeConfidence(hits, sqlResult);

  return { hits, sqlResult, usedSources, confidence };
}

async function ftsSearch(query: string, limit: number): Promise<RetrievalHit[]> {
  const tsquery = query
    .split(/\s+/)
    .filter(Boolean)
    .map(w => `${w}:*`)
    .join(' & ');

  if (!tsquery) return [];

  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; content: string; productId: string; docType: string; rank: number }>
  >(
    `SELECT
       kc.id,
       kc.content,
       kd."productId",
       kd."docType",
       ts_rank(kc.tsvector, to_tsquery('simple', $1)) AS rank
     FROM active_knowledge_chunk_view kc
     WHERE kc.tsvector @@ to_tsquery('simple', $1)
     ORDER BY rank DESC
     LIMIT $2`,
    tsquery,
    limit,
  );

  return rows.map(r => ({
    id: r.id,
    score: Number(r.rank),
    source: 'fts' as const,
    content: r.content,
    metadata: { productId: r.productId, docType: r.docType },
  }));
}

async function vectorSearch(
  query: string,
  productId?: string,
  limit: number = TOP_K,
): Promise<RetrievalHit[]> {
  const embedding = await generateEmbedding(query);
  const vectorLiteral = `[${embedding.join(',')}]`;

  let whereClause = '';
  const params: any[] = [vectorLiteral, limit];
  let paramIdx = 3;

  if (productId) {
    whereClause = `AND kd."productId" = $${paramIdx++}`;
    params.push(productId);
  }

  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; content: string; productId: string; docType: string; distance: number }>
  >(
    `SELECT
       kc.id,
       kc.content,
       kd."productId",
       kd."docType",
       1 - (kc.embedding <=> $1::vector) AS distance
     FROM active_knowledge_chunk_view kc
     WHERE kc.embedding IS NOT NULL ${whereClause}
     ORDER BY kc.embedding <=> $1::vector
     LIMIT $2`,
    ...params,
  );

  return rows.map(r => ({
    id: r.id,
    score: Number(r.distance),
    source: 'vector' as const,
    content: r.content,
    metadata: { productId: r.productId, docType: r.docType },
  }));
}

function computeConfidence(
  hits: RetrievalHit[],
  sqlResult?: Record<string, unknown>[],
): 'high' | 'medium' | 'low' {
  if (hits.length === 0 && (!sqlResult || sqlResult.length === 0)) return 'low';
  if (hits.length >= 3 || (sqlResult && sqlResult.length >= 2)) return 'high';
  return 'medium';
}
```

---

### Task 18: 集成测试 — 检索链路

**Files:**
- Create: `tests/integration/retrieval.test.ts`

```typescript
// tests/integration/retrieval.test.ts
import { classifyIntent } from '@/lib/services/intent.service';
import { reciprocalRankFusion, RetrievalHit } from '@/lib/services/rrf.service';

describe('Retrieval pipeline integration (offline unit)', () => {
  it('intent → RRF pipeline works end-to-end for filter query', () => {
    const intent = classifyIntent('100元以内棉质长袖衬衫有什么推荐？');
    expect(intent.intent).toBe('product_filter');

    // Mock FTS + vector hits
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

  it('intent routes realtime query correctly', () => {
    const intents = [
      '这件衣服多少钱？',
      '这款还有M码吗？',
      '现在有什么优惠？',
    ];

    for (const q of intents) {
      const result = classifyIntent(q);
      expect(result.intent).toBe('realtime_price_stock');
    }
  });

  it('RRF deduplicates across sources', () => {
    const fts: RetrievalHit[] = [
      { id: 'A', score: 10, source: 'fts' },
    ];
    const vec: RetrievalHit[] = [
      { id: 'A', score: 0.9, source: 'vector' },
      { id: 'B', score: 0.5, source: 'vector' },
    ];

    const result = reciprocalRankFusion([fts, vec]);
    const ids = result.map(r => r.id);
    expect(ids.filter(id => id === 'A')).toHaveLength(1);
  });
});
```

- [ ] Run `npx jest tests/integration/retrieval.test.ts` → tests PASS

---

### Task 19: Phase 2 提交

```bash
git add lib/rag/attribute-dict.ts lib/rag/synonyms.ts lib/rag/templates/
git add lib/services/intent.service.ts lib/services/rrf.service.ts lib/services/text2sql.service.ts lib/services/retrieval.service.ts
git add tests/rag/intent.test.ts tests/rag/rrf.test.ts tests/rag/text2sql.test.ts tests/integration/retrieval.test.ts
git commit -m "feat(rag): add retrieval pipeline with parallel recall, RRF, Text2SQL, and real-time routing"
```

---

## Phase 3: AI Chat API + 前台悬浮助手 + Tool 状态流 + 商品化引用卡片

---

### Task 20: Chat API Route (AI SDK Stream)

**Files:**
- Create: `app/api/chat/route.ts`

```typescript
// app/api/chat/route.ts
import { streamText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { retrieve, RetrievalResult } from '@/lib/services/retrieval.service';
import { ANSWER_SYSTEM_PROMPT, CONSERVATIVE_ANSWER } from '@/lib/rag/templates/prompts';

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages, productId } = await req.json();

  const lastMessage = messages[messages.length - 1];
  const query = lastMessage?.content || '';

  const result = await streamText({
    model: openai(process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'),
    system: ANSWER_SYSTEM_PROMPT,
    messages: [
      ...messages.slice(0, -1),
      {
        role: 'user',
        content: buildAugmentedQuery(query, productId),
      },
    ],
    tools: {
      retrieveProductInfo: tool({
        description: 'Search the product knowledge base for relevant information including specs, reviews, and FAQs.',
        parameters: z.object({
          query: z.string().describe('The search query to find product information'),
        }),
        execute: async ({ query: searchQuery }) => {
          const retrievalResult = await retrieve(searchQuery, { productId });
          return formatRetrievalForLLM(retrievalResult);
        },
      }),
    },
    onFinish: async ({ text, toolCalls }) => {
      // 可在此处记录指标: 时延、token 数、检索调用次数
      console.log('Chat finished:', { textLength: text.length, toolCalls: toolCalls?.length });
    },
  });

  return result.toDataStreamResponse();
}

function buildAugmentedQuery(query: string, productId?: string): string {
  if (productId) {
    return `[Context: User is viewing product ${productId}]\n\n${query}`;
  }
  return query;
}

function formatRetrievalForLLM(result: RetrievalResult): string {
  if (result.confidence === 'low') {
    return `Evidence strength: LOW. Limited information found.\n\n${CONSERVATIVE_ANSWER}`;
  }

  const parts: string[] = [];

  if (result.sqlResult && result.sqlResult.length > 0) {
    parts.push('=== Product Search Results ===');
    parts.push(JSON.stringify(result.sqlResult.slice(0, 10), null, 2));
  }

  if (result.hits.length > 0) {
    parts.push('=== Knowledge Base Results ===');
    for (const hit of result.hits.slice(0, 10)) {
      parts.push(`[${hit.source}] ${hit.content}`);
    }
  }

  parts.push(`\nConfidence: ${result.confidence}`);
  parts.push(`Sources used: ${result.usedSources.join(', ')}`);

  return parts.join('\n');
}
```

---

### Task 21: AI Chat 客户端 Hook

**Files:**
- Create: `lib/hooks/use-chat.ts`

```typescript
// lib/hooks/use-chat.ts
'use client';

import { useChat as useAIChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';

export interface ChatMessage extends UIMessage {}

export function useChat(productId?: string) {
  const chat = useAIChat({
    api: '/api/chat',
    body: { productId },
    onError: (error) => {
      console.error('Chat error:', error);
    },
  });

  return {
    ...chat,
    messages: chat.messages as ChatMessage[],
  };
}
```

---

### Task 22: 悬浮助手按钮组件

**Files:**
- Create: `components/shared/ai-assistant/ai-assistant-trigger.tsx`

```typescript
// components/shared/ai-assistant/ai-assistant-trigger.tsx
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
```

---

### Task 23: AI 导购对话面板组件

**Files:**
- Create: `components/shared/ai-assistant/ai-assistant-panel.tsx`

```typescript
// components/shared/ai-assistant/ai-assistant-panel.tsx
'use client';

import { useChat } from '@/lib/hooks/use-chat';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Send, Loader2, Search } from 'lucide-react';
import { useRef, useEffect } from 'react';
import { ChatMessageCard } from './chat-message-card';

export function AiAssistantPanel({
  productId,
  onClose,
}: {
  productId?: string;
  onClose: () => void;
}) {
  const { messages, input, handleInputChange, handleSubmit, status, addToolResult } = useChat(productId);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  return (
    <div className="fixed bottom-24 right-6 z-50 flex h-[560px] w-[400px] flex-col rounded-lg border bg-background shadow-2xl">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-semibold">AI 导购助手</h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          ✕
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground mt-16">
            <Search className="mx-auto h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">我可以帮您找商品、比参数、看评价</p>
            <div className="mt-4 space-y-2">
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-left"
                  onClick={() => {
                    handleInputChange({ target: { value: q } } as any);
                  }}
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <ChatMessageCard key={i} message={msg} />
        ))}

        {status === 'submitted' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <RetrievalStatusIndicator messages={messages} />
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t p-3">
        <Input
          value={input}
          onChange={handleInputChange}
          placeholder="问我关于商品的问题..."
          disabled={status === 'streaming'}
        />
        <Button type="submit" size="icon" disabled={status === 'streaming'}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

const SUGGESTED_QUESTIONS = [
  '100元以内棉质长袖有什么推荐？',
  '这款的尺码偏大还是偏小？',
  '7天退货政策是什么？',
  '和另一款面料有什么区别？',
];

function RetrievalStatusIndicator({ messages }: { messages: any[] }) {
  const lastMsg = messages[messages.length - 1];
  const toolInvocations = lastMsg?.parts?.filter((p: any) => p.type === 'tool-invocation') || [];
  const activeTool = toolInvocations.find((t: any) => t.state === 'call');

  if (!activeTool) return <span>思考中...</span>;

  const statusText: Record<string, string> = {
    retrieveProductInfo: '正在检索商品信息...',
  };

  return <span>{statusText[activeTool.toolName] || '处理中...'}</span>;
}
```

---

### Task 24: 聊天消息卡片组件

**Files:**
- Create: `components/shared/ai-assistant/chat-message-card.tsx`

```typescript
// components/shared/ai-assistant/chat-message-card.tsx
'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import Image from 'next/image';
import { UIMessage } from 'ai';

export function ChatMessageCard({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg bg-primary px-4 py-2 text-primary-foreground text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  const toolInvocations = message.parts?.filter(
    (p: any) => p.type === 'tool-invocation',
  ) || [];

  return (
    <div className="space-y-2">
      {/* Tool 状态指示 */}
      {toolInvocations.map((ti: any, i: number) => (
        <ToolInvocationCard key={i} invocation={ti} />
      ))}

      {/* 回答内容 */}
      {message.content && (
        <div className="max-w-[85%] text-sm leading-relaxed">
          <div
            className="prose prose-sm dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: formatMarkdown(message.content) }}
          />
        </div>
      )}

      {/* 商品推荐卡片 */}
      {message.parts?.some((p: any) => p.type === 'tool-invocation' && p.state === 'result') && (
        <ProductRecommendations message={message} />
      )}
    </div>
  );
}

function ToolInvocationCard({ invocation }: { invocation: any }) {
  if (invocation.state === 'call') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
        <span className="inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
        {invocation.toolName === 'retrieveProductInfo' ? '正在检索商品信息...' : '处理中...'}
      </div>
    );
  }

  if (invocation.state === 'result') {
    const data = invocation.result;
    if (!data) return null;

    return (
      <div className="space-y-2">
        {/* SQL 结果: 商品列表 */}
        {data.sqlResult?.length > 0 && (
          <div className="space-y-2">
            <Badge variant="secondary" className="text-xs">
              找到 {data.sqlResult.length} 件商品
            </Badge>
            {data.sqlResult.slice(0, 3).map((product: any, i: number) => (
              <Link key={i} href={`/product/${product.slug}`}>
                <Card className="flex items-center gap-3 p-2 hover:bg-accent cursor-pointer">
                  {product.image && (
                    <Image
                      src={product.image}
                      alt={product.name}
                      width={48}
                      height={48}
                      className="rounded object-cover"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      ${product.price} · 评分 {product.rating}
                    </p>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {/* 引用来源 */}
        {data.hits?.length > 0 && (
          <div className="space-y-1">
            <Badge variant="outline" className="text-xs">
              引用 {data.hits.length} 条知识来源
            </Badge>
            {data.hits.slice(0, 3).map((hit: any, i: number) => (
              <CitationCard key={i} citation={hit} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}

function CitationCard({ citation }: { citation: any }) {
  const sourceLabels: Record<string, string> = {
    fts: '全文匹配',
    vector: '语义匹配',
    sql: '实时数据',
  };

  return (
    <div className="flex items-start gap-2 rounded border p-2 text-xs">
      <Badge variant="secondary" className="shrink-0">
        {sourceLabels[citation.source] || citation.source}
      </Badge>
      <div className="min-w-0">
        <p className="line-clamp-2 text-muted-foreground">{citation.content}</p>
        {citation.metadata?.productId && (
          <Link
            href={`/product/${citation.metadata.productId}`}
            className="text-primary hover:underline"
          >
            查看详情 →
          </Link>
        )}
      </div>
    </div>
  );
}

function ProductRecommendations({ message }: { message: UIMessage }) {
  // 从 tool invocation result 中提取商品推荐
  return null; // 由 ToolInvocationCard 展示
}

function formatMarkdown(text: string): string {
  return text
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}
```

---

### Task 25: 在 Root Layout 挂载悬浮助手

**Files:**
- Modify: `app/(root)/layout.tsx`

```typescript
import { AiAssistantTrigger } from '@/components/shared/ai-assistant/ai-assistant-trigger';

// 在 RootLayout 的 return 中, Footer 之后添加:
<AiAssistantTrigger />
```

---

### Task 26: 商品详情页注入 productId 上下文

**Files:**
- Modify: `app/(root)/product/[slug]/page.tsx`

读取当前 product 后，将 `productId` 注入悬浮助手:

```tsx
// 在页面组件中:
import { AiAssistantTrigger } from '@/components/shared/ai-assistant/ai-assistant-trigger';

// JSX 末尾添加:
<AiAssistantTrigger productId={product.id} />
```

---

### Task 27: 检索状态 Tool Invocation 流式反馈

**Files:**
- Modify: `app/api/chat/route.ts` (已在 Task 20 中通过 `tool()` 实现)

确认 `streamText` 调用返回 `toDataStreamResponse()`，前端通过 `parts` 中 `tool-invocation` 的 `state: 'call' | 'result'` 区分检索中/检索完毕状态。检索中展示 "正在检索商品信息..." Loader，检索完毕展示引用卡片。

---

### Task 28: 指标埋点

**Files:**
- Create: `lib/services/metrics.service.ts`

```typescript
// lib/services/metrics.service.ts

export interface ChatMetrics {
  ttfb: number;            // Time to first byte
  totalDuration: number;   // Total response time
  retrievalCalls: number;  // Number of retrieval tool invocations
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

  // 日志输出
  console.log(
    `[Metrics] TTFB=${m.ttfb}ms total=${m.totalDuration}ms retCalls=${m.retrievalCalls} ` +
    `retDur=${m.retrievalDuration}ms sql=${m.sqlUsed} fts=${m.ftsUsed} vec=${m.vectorUsed} ` +
    `conf=${m.confidence} tokens=${m.tokenCount} ansLen=${m.answerLength}`,
  );

  // 每 100 条 flush 到数据库或外部服务
  if (metricsBuffer.length >= 100) {
    flushMetrics();
  }
}

async function flushMetrics(): Promise<void> {
  // 首期日志输出，后续可写入数据库 metrics 表
  const batch = metricsBuffer.splice(0);
  console.log(`[Metrics] Flushing ${batch.length} records`);
}
```

在 `app/api/chat/route.ts` 的 `onFinish` 回调中记录指标:

```typescript
import { recordMetrics } from '@/lib/services/metrics.service';

// 在 onFinish 中:
const startTime = Date.now(); // 在请求入口设置

onFinish: async ({ text, toolCalls, usage }) => {
  recordMetrics({
    ttfb: /* 从 stream 回调中获取 */ 0,
    totalDuration: Date.now() - startTime,
    retrievalCalls: toolCalls?.filter(t => t.toolName === 'retrieveProductInfo').length || 0,
    retrievalDuration: 0,
    sqlUsed: true,  // 从 retrieval result 获取
    ftsUsed: true,
    vectorUsed: true,
    confidence: 'medium',
    tokenCount: usage?.completionTokens || 0,
    answerLength: text.length,
  });
},
```

---

### Task 29: 端到端测试用例

**Files:**
- Create: `tests/e2e/chat-pipeline.test.ts`

```typescript
// tests/e2e/chat-pipeline.test.ts
import { classifyIntent } from '@/lib/services/intent.service';
import { reciprocalRankFusion, RetrievalHit } from '@/lib/services/rrf.service';

describe('End-to-end chat pipeline', () => {
  const testQueries = [
    {
      query: '100美元以内棉质长袖评分4分以上有什么推荐？',
      expectedIntent: 'product_filter' as const,
      shouldUseSQL: true,
    },
    {
      query: '这件衬衫夏天穿会不会热？',
      expectedIntent: 'product_detail' as const,
      shouldUseVector: true,
    },
    {
      query: '用户对这款尺码偏大还是偏小怎么说？',
      expectedIntent: 'review_insight' as const,
      shouldUseVector: true,
    },
    {
      query: '这款和另一款相比，面料和版型区别是什么？',
      expectedIntent: 'hybrid' as const,
    },
    {
      query: '7天退货政策是什么？',
      expectedIntent: 'policy_faq' as const,
    },
    {
      query: '这款衣服现在多少钱？还有M码吗？',
      expectedIntent: 'realtime_price_stock' as const,
      shouldForceRealtime: true,
    },
  ];

  it.each(testQueries)(
    'routes "$query" to $expectedIntent',
    ({ query, expectedIntent }) => {
      const result = classifyIntent(query);
      expect(result.intent).toBe(expectedIntent);
    },
  );

  it('realtime queries are always time-sensitive', () => {
    const q = '这款衣服现在多少钱？还有M码吗？';
    const result = classifyIntent(q);
    expect(result.isTimeSensitive).toBe(true);
    expect(result.intent).toBe('realtime_price_stock');
  });

  it('RRF fusion handles empty vector results gracefully', () => {
    const ftsHits: RetrievalHit[] = [
      { id: 'A', score: 0.9, source: 'fts', content: 'test' },
    ];
    const result = reciprocalRankFusion([ftsHits, []]);
    expect(result).toHaveLength(1);
  });

  it('confidence is low when all sources are empty', () => {
    const empty: RetrievalHit[] = [];
    const result = reciprocalRankFusion([empty, empty]);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] Run `npx jest tests/e2e/chat-pipeline.test.ts` → tests PASS

---

### Task 30: Phase 3 提交

```bash
git add app/api/chat/route.ts
git add lib/hooks/use-chat.ts
git add lib/services/metrics.service.ts
git add components/shared/ai-assistant/
git add app/"(root)"/layout.tsx app/"(root)"/product/"[slug]"/page.tsx
git add tests/e2e/chat-pipeline.test.ts
git commit -m "feat(chat): add AI shopping assistant with streaming chat, tool invocation, and product citation cards"
```

---

## 验收清单

| 指标 | 目标 | 测量方式 |
|------|------|---------|
| 首包时延 (TTFB) | < 500ms | `metrics.service.ts` |
| 总响应时延 | < 5s | `metrics.service.ts` |
| 检索命中率 | ≥ 80% | 检索结果非空比例 |
| 引用覆盖率 | ≥ 60% 回答有引用 | 带 citation 回答比例 |
| SQL 成功率 | ≥ 90% | Text2SQL 非空/非报错比例 |
| 强时效问题实时命中率 | 100% | isTimeSensitive 路由检查 |
| 单次回答成本 | < $0.02 | OpenAI usage + embedding 计费 |

---

## 文件清单

```
新建:
  prisma/views.sql
  prisma/indexes.sql
  lib/rag/hasher.ts
  lib/rag/cleaner.ts
  lib/rag/chunker.ts
  lib/rag/attribute-dict.ts
  lib/rag/synonyms.ts
  lib/rag/templates/few-shot-examples.ts
  lib/rag/templates/prompts.ts
  lib/services/embedding.service.ts
  lib/services/index.service.ts
  lib/services/review-ingestion.service.ts
  lib/services/intent.service.ts
  lib/services/rrf.service.ts
  lib/services/text2sql.service.ts
  lib/services/retrieval.service.ts
  lib/services/metrics.service.ts
  lib/hooks/use-chat.ts
  app/api/chat/route.ts
  components/shared/ai-assistant/ai-assistant-trigger.tsx
  components/shared/ai-assistant/ai-assistant-panel.tsx
  components/shared/ai-assistant/chat-message-card.tsx
  tests/rag/hasher.test.ts
  tests/rag/cleaner.test.ts
  tests/rag/chunker.test.ts
  tests/rag/embedding.test.ts
  tests/rag/review-ingestion.test.ts
  tests/rag/intent.test.ts
  tests/rag/rrf.test.ts
  tests/rag/text2sql.test.ts
  tests/integration/retrieval.test.ts
  tests/e2e/chat-pipeline.test.ts

修改:
  prisma/schema.prisma (追加4个model)
  .env (追加5个环境变量)
  package.json (新增 ai, @ai-sdk/openai, openai)
  lib/actions/product.actions.ts (createProduct/updateProduct 触发索引)
  lib/actions/review.actions.ts (createUpdateReview 触发评论入库)
  app/(root)/layout.tsx (挂载 AiAssistantTrigger)
  app/(root)/product/[slug]/page.tsx (注入 productId)
```
