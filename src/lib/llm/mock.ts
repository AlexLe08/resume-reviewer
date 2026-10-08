import type { StreamChunk, StructuredStreamRequest } from './types';

export interface MockConfig {
  delayMs: number;
  /** Builds the object to "return". The composition root decides what that is. */
  respond: (request: StructuredStreamRequest) => unknown;
}

const CHUNK_SIZE = 24;

/**
 * A fake provider for UI work and demos: no network, no quota, no model.
 * Streams `respond(request)` as JSON in small chunks so streaming UI states
 * still get exercised.
 */
export function createMockProvider(config: MockConfig) {
  return async function* streamStructuredMock(
    request: StructuredStreamRequest,
  ): AsyncGenerator<StreamChunk> {
    const text = JSON.stringify(config.respond(request), null, 2);

    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error('Aborted');
      if (config.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, config.delayMs));
      yield { text: text.slice(i, i + CHUNK_SIZE), model: 'mock' };
    }

    yield {
      text: '',
      model: 'mock',
      usage: {
        inputTokens: Math.ceil((request.system.length + request.user.length) / 4),
        outputTokens: Math.ceil(text.length / 4),
        thinkingTokens: 0,
      },
    };
  };
}
