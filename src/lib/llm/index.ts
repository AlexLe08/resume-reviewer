import { getEnv, type Env } from '@/lib/env';
import { buildMockReview } from '@/lib/review/mock';
import { ProviderError } from './errors';
import { streamStructuredGemini } from './gemini';
import { createMockProvider } from './mock';
import { createOllamaProvider } from './ollama';
import { errorStatus, withRetry } from './retry';
import type { StreamChunk, StructuredStreamRequest } from './types';
import type { Prices } from './usage';

export type { StreamChunk, StructuredStreamRequest, TokenUsage } from './types';

export type ProviderId = Env['LLM_PROVIDER'];
type Provider = (request: StructuredStreamRequest) => AsyncGenerator<StreamChunk>;

/**
 * The composition root for model access: the one place that maps config to a
 * concrete provider. The rest of the app calls streamStructured() and never
 * knows which provider answered.
 */
function getProvider(env: Env): Provider {
  switch (env.LLM_PROVIDER) {
    case 'gemini':
      return streamStructuredGemini;
    case 'ollama':
      return createOllamaProvider({
        baseUrl: env.OLLAMA_BASE_URL.replace(/\/+$/, ''),
        model: env.OLLAMA_MODEL,
        numCtx: env.OLLAMA_NUM_CTX,
      });
    case 'mock':
      return createMockProvider({
        delayMs: env.MOCK_DELAY_MS,
        respond: (request) => buildMockReview(request.user),
      });
  }
}

export function streamStructured(request: StructuredStreamRequest): AsyncGenerator<StreamChunk> {
  const provider = getProvider(getEnv());
  return withRetry(() => provider(request), {
    attempts: 3,
    baseDelayMs: 1000,
    signal: request.signal,
    onRetry: ({ attempt, delayMs, status }) =>
      console.warn(
        JSON.stringify({ event: 'llm_retry', provider: providerName(), model: modelName(), attempt, status, delayMs }),
      ),
  });
}

export function providerName(): ProviderId {
  return getEnv().LLM_PROVIDER;
}

/** The model we ASK for. Logs prefer the model the provider reports back. */
export function modelName(): string {
  const env = getEnv();
  switch (env.LLM_PROVIDER) {
    case 'gemini':
      return env.GEMINI_MODEL;
    case 'ollama':
      return env.OLLAMA_MODEL;
    case 'mock':
      return 'mock';
  }
}

/** Paid-tier prices for cost estimates. Local and mock calls cost nothing. */
export function currentPrices(): Prices {
  const env = getEnv();
  if (env.LLM_PROVIDER !== 'gemini') return { inputPerMTok: 0, outputPerMTok: 0 };
  return { inputPerMTok: env.LLM_INPUT_PRICE_PER_MTOK, outputPerMTok: env.LLM_OUTPUT_PRICE_PER_MTOK };
}

/** Turns provider errors into messages a user can act on. */
export function describeLlmError(err: unknown): { message: string; retryable: boolean } {
  // Our own provider errors already carry an actionable message.
  if (err instanceof ProviderError) {
    const permanent = err.code === 'model_not_found' || err.code === 'structured_output_unsupported';
    return { message: err.message, retryable: !permanent };
  }

  const status = errorStatus(err);

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
    return {
      message: 'The AI service is overloaded right now. We retried a few times without luck. Try again in a minute.',
      retryable: true,
    };
  }
  return { message: 'The review could not be completed. Try again.', retryable: true };
}
