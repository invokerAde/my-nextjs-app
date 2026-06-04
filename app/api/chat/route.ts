import { streamText, convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { retrieve } from '@/lib/services/retrieval.service';
import { extractProductImages } from '@/lib/rag/product-image';
import { ANSWER_SYSTEM_PROMPT, CONSERVATIVE_ANSWER } from '@/lib/rag/templates/prompts';

const llm = createOpenAICompatible({
  name: 'deepseek',
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
});

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages, productId } = await req.json();

  const lastMessage = messages[messages.length - 1];
  const query = typeof lastMessage?.content === 'string'
    ? lastMessage.content
    : (lastMessage?.parts?.find((p: any) => p.type === 'text')?.text || '');

  // 前置检索：先查知识库，将结果注入上下文
  let retrievalContext = '';
  let productImageGroups: ReturnType<typeof extractProductImages> = [];
  try {
    const retrievalResult = await retrieve(query, { productId });
    const hasHits = retrievalResult.hits.length > 0;

    productImageGroups = extractProductImages(retrievalResult.hits);

    if (retrievalResult.confidence !== 'low' && hasHits) {
      const parts: string[] = ['\n\n--- 知识库检索结果 ---'];

      parts.push('\n[商品检索结果]');
      for (const hit of retrievalResult.hits.slice(0, 10)) {
        const meta = (hit.metadata || {}) as Record<string, unknown>;
        const fields: string[] = [];
        if (meta.name) fields.push(`商品: ${meta.name}`);
        if (meta.brand) fields.push(`品牌: ${meta.brand}`);
        if (meta.category) fields.push(`类目: ${meta.category}`);
        if (meta.price != null) fields.push(`价格: ¥${meta.price}`);
        if (meta.rating != null) fields.push(`评分: ${meta.rating}/5`);
        if (meta.numReviews != null) fields.push(`${meta.numReviews}条评价`);
        if (meta.stock != null) fields.push(`库存: ${meta.stock}件`);
        if (meta.material) fields.push(`材质: ${meta.material}`);
        if (meta.fit) fields.push(`版型: ${meta.fit}`);
        const metaLine = fields.length > 0 ? ` | ${fields.join(' | ')}` : '';
        parts.push(`[来源: ${retrievalResult.usedSources.join('+')}]${metaLine} ${hit.content?.substring(0, 300)}`);
      }

      parts.push(`可信度: ${retrievalResult.confidence}`);
      retrievalContext = parts.join('\n');
    }
  } catch (err) {
    console.error('Retrieval error:', err);
  }

  const systemPrompt = retrievalContext
    ? `${ANSWER_SYSTEM_PROMPT}\n\n以下是相关的商品和知识库信息，请在回答时引用：${retrievalContext}`
    : ANSWER_SYSTEM_PROMPT;

  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: llm(process.env.OPENAI_CHAT_MODEL || 'deepseek-v4-pro'),
    system: systemPrompt,
    messages: modelMessages,
  });

  // Combine text stream + product image data parts using AI SDK v6 stream API
  const textStream = result.toUIMessageStream();

  const combinedStream = createUIMessageStream({
    execute: async ({ writer }) => {
      // Write product image data part first (before text)
      if (productImageGroups.length > 0) {
        writer.write({
          type: 'data-product-images',
          data: { productImageGroups },
        } as any);
      }
      // Merge text stream (writer handles SSE framing automatically)
      writer.merge(textStream);
    },
  });

  return createUIMessageStreamResponse({ stream: combinedStream });
}
