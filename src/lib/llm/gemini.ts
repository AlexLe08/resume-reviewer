import { GoogleGenAI } from '@google/genai';
import { getEnv } from '@/lib/env';
import type { StreamChunk, StructuredStreamRequest } from './types';

let client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: getEnv().GEMINI_API_KEY });
  return client;
}

/**
 * Streams a JSON response that follows `jsonSchema`. Yields text as it arrives
 * plus token usage (the final chunk carries the totals).
 *
 * This is the only file that knows we're using Gemini.
 */
export async function* streamStructuredGemini(
  request: StructuredStreamRequest,
): AsyncGenerator<StreamChunk> {
  const stream = await getClient().models.generateContentStream({
    model: getEnv().GEMINI_MODEL,
    contents: request.user,
    config: {
      systemInstruction: request.system,
      responseMimeType: 'application/json',
      responseJsonSchema: request.jsonSchema,
      temperature: request.temperature,
      abortSignal: request.signal,
    },
  });

  for await (const chunk of stream) {
    const usage = chunk.usageMetadata;
    yield {
      text: chunk.text ?? '',
      usage: usage
        ? {
            inputTokens: usage.promptTokenCount ?? 0,
            outputTokens: usage.candidatesTokenCount ?? 0,
            thinkingTokens: usage.thoughtsTokenCount ?? 0,
          }
        : undefined,
    };
  }
}
