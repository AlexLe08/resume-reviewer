import { getEnv } from '@/lib/env';

/**
 * The rest of the app imports from here, never from a provider file directly.
 * Switching providers (or adding a local Ollama option) means changing this
 * file, not every caller.
 */
export { streamStructuredGemini as streamStructured } from './gemini';
export type { StreamChunk, StructuredStreamRequest, TokenUsage } from './types';

export function modelName(): string {
  return getEnv().GEMINI_MODEL;
}

/** Turns provider errors into messages a user can act on. */
export function describeLlmError(err: unknown): { message: string; retryable: boolean } {
  const status =
    typeof err === 'object' && err !== null && 'status' in err ? Number(err.status) : undefined;

  if (status === 429) {
    return {
      message: 'The AI service is limiting requests right now (free-tier rate limit). Wait a minute and try again.',
      retryable: true,
    };
  }
  if (status === 401 || status === 403) {
    return {
      message: 'The server could not authenticate with the AI service. Check GEMINI_API_KEY in .env.local.',
      retryable: false,
    };
  }
  if (status !== undefined && status >= 500) {
    return { message: 'The AI service had a temporary problem. Try again.', retryable: true };
  }
  return { message: 'The review could not be completed. Try again.', retryable: true };
}
