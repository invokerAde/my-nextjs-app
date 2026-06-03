import { streamText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { retrieve } from '@/lib/services/retrieval.service';
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
  const query = lastMessage?.content || '';

  // 前置检索：先查知识库，将结果注入上下文
  let retrievalContext = '';
  try {
    const retrievalResult = await retrieve(query, { productId });
    if (retrievalResult.confidence !== 'low' && retrievalResult.hits.length > 0) {
      const parts: string[] = ['\n\n--- 知识库检索结果 ---'];
      for (const hit of retrievalResult.hits.slice(0, 5)) {
        parts.push(`[来源: ${hit.source}] ${hit.content}`);
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

  const result = streamText({
    model: llm(process.env.OPENAI_CHAT_MODEL || 'deepseek-v4-pro'),
    system: systemPrompt,
    messages,
  });

  return result.toTextStreamResponse();
}
