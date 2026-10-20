import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProviderError } from './errors';
import { createReplayProvider, readRecording, requestKey, withRecording } from './replay';
import type { StreamChunk, StructuredStreamRequest } from './types';

const REQUEST: StructuredStreamRequest = { system: 'sys', user: 'user', jsonSchema: { type: 'object' } };

async function collect(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

async function* fakeModel(): AsyncGenerator<StreamChunk> {
  yield { text: '{"a":', model: 'gemma-test' };
  yield { text: '1}', model: 'gemma-test' };
  yield { text: '', model: 'gemma-test', usage: { inputTokens: 10, outputTokens: 3, thinkingTokens: 0 } };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'replay-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('requestKey', () => {
  it('is stable, and changes with either prompt or the schema', () => {
    expect(requestKey(REQUEST)).toBe(requestKey({ ...REQUEST }));
    expect(requestKey({ ...REQUEST, system: 'other' })).not.toBe(requestKey(REQUEST));
    expect(requestKey({ ...REQUEST, user: 'other' })).not.toBe(requestKey(REQUEST));
    expect(requestKey({ ...REQUEST, jsonSchema: { type: 'array' } })).not.toBe(requestKey(REQUEST));
  });

  it('ignores temperature and the signal, which the model never sees as text', () => {
    const warm: StructuredStreamRequest = { ...REQUEST, temperature: 0.4 };
    expect(requestKey(warm)).toBe(requestKey(REQUEST));
  });
});

describe('recording and replaying', () => {
  it('plays back exactly what the recorded model said, with its model name and usage', async () => {
    await collect(withRecording(fakeModel, dir)(REQUEST));
    const replayed = await collect(createReplayProvider({ dir, delayMs: 0 })(REQUEST));
    expect(replayed.map((c) => c.text).join('')).toBe('{"a":1}');
    expect(replayed[0]?.model).toBe('gemma-test');
    expect(replayed.at(-1)?.usage).toEqual({ inputTokens: 10, outputTokens: 3, thinkingTokens: 0 });
  });

  it('saves nothing when the model call fails partway', async () => {
    async function* failing(): AsyncGenerator<StreamChunk> {
      yield { text: '{"a"', model: 'gemma-test' };
      throw new Error('connection lost');
    }
    await expect(collect(withRecording(failing, dir)(REQUEST))).rejects.toThrow('connection lost');
    expect(await readRecording(dir, requestKey(REQUEST))).toBeUndefined();
  });

  it('says plainly that there is no recording for a prompt it has not seen', async () => {
    const error = await collect(createReplayProvider({ dir, delayMs: 0 })(REQUEST)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe('no_recording');
    expect((error as ProviderError).message).toContain('sample');
  });
});
