import { streamText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { retrieve } from '@/lib/services/retrieval.service';
import { ANSWER_SYSTEM_PROMPT, CONSERVATIVE_ANSWER } from '@/lib/rag/templates/prompts';

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages, productId } = await req.json();

  const result = streamText({
    model: openai(process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'),
    system: ANSWER_SYSTEM_PROMPT,
    messages,
    tools: {
      retrieveProductInfo: tool({
        description: 'Search the product knowledge base for relevant information including specs, reviews, and FAQs.',
        inputSchema: z.object({
          query: z.string().describe('The search query to find product information'),
        }),
        execute: async ({ query: searchQuery }) => {
          const retrievalResult = await retrieve(searchQuery, { productId });
          return formatRetrievalForLLM(retrievalResult);
        },
      }),
    },
  });

  return result.toTextStreamResponse();
}

function formatRetrievalForLLM(result: any): string {
  if (result.confidence === 'low') {
    return `Evidence strength: LOW.\n\n${CONSERVATIVE_ANSWER}`;
  }

  const parts: string[] = [];

  if (result.sqlResult && result.sqlResult.length > 0) {
    parts.push('=== Product Search Results ===');
    parts.push(JSON.stringify(result.sqlResult.slice(0, 10), null, 2));
  }

  if (result.hits.length > 0) {
    parts.push('=== Knowledge Base Results ===');
    for (const hit of result.hits.slice(0, 10)) {
      parts.push(`[Source: ${hit.source}] ${hit.content}`);
    }
  }

  parts.push(`\nConfidence: ${result.confidence}`);
  parts.push(`Sources used: ${result.usedSources.join(', ')}`);

  return parts.join('\n');
}
