import { describe, expect, it } from 'vitest';
import { ProviderError } from './errors';
import { createOllamaProvider } from './ollama';
import type { StreamChunk } from './types';

const REQUEST = { system: 'sys', user: 'user', jsonSchema: { type: 'object' } };

function ndjsonResponse(lines: object[], status = 200): Response {
  const body = lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
  return new Response(body, { status });
}

function provider(fetchImpl: () => Promise<Response>) {
  return createOllamaProvider({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'test-model',
    numCtx: 4096,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

async function collect(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

describe('createOllamaProvider', () => {
  it('streams text and reports usage from the final line', async () => {
    const stream = provider(async () =>
      ndjsonResponse([
        { model: 'test-model', message: { content: '{"a":' }, done: false },
        { model: 'test-model', message: { content: '1}' }, done: false },
        { model: 'test-model', message: { content: '' }, done: true, prompt_eval_count: 120, eval_count: 30 },
      ]),
    );
    const chunks = await collect(stream(REQUEST));
    expect(chunks.map((c) => c.text).join('')).toBe('{"a":1}');
    expect(chunks.at(-1)?.usage).toEqual({ inputTokens: 120, outputTokens: 30, thinkingTokens: 0 });
    expect(chunks[0]?.model).toBe('test-model');
  });

  it('explains how to fix a missing model', async () => {
    const stream = provider(async () => new Response('{"error":"model not found"}', { status: 404 }));
    await expect(collect(stream(REQUEST))).rejects.toMatchObject({ code: 'model_not_found' });
  });

  it('reports an unreachable server without a status, so it is not retried', async () => {
    const stream = provider(async () => {
      throw new TypeError('fetch failed');
    });
    const error = await collect(stream(REQUEST)).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: 'unreachable', status: undefined });
  });

  it('surfaces an error that arrives mid-stream', async () => {
    const stream = provider(async () =>
      ndjsonResponse([{ message: { content: '{' } }, { error: 'out of memory' }]),
    );
    await expect(collect(stream(REQUEST))).rejects.toThrow('out of memory');
  });

    it('explains a missing structured-output feature', async () => {
    const stream = provider(async () =>
      new Response('{"error":"structured output is unavailable"}', { status: 501 }),
    );
    await expect(collect(stream(REQUEST))).rejects.toMatchObject({
      code: 'structured_output_unsupported',
      status: 501,
    });
  });
});
