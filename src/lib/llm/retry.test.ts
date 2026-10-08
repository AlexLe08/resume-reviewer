import { describe, expect, it } from 'vitest';
import type { StreamChunk } from './types';
import { withRetry } from './retry';

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

/** A fake streaming call that throws `status` for the first `failures` attempts, then succeeds. */
function flakyCall(failures: number, status: number) {
  let calls = 0;
  async function* start(): AsyncGenerator<StreamChunk> {
    calls++;
    if (calls <= failures) throw httpError(status);
    yield { text: 'hello ' };
    yield { text: 'world' };
  }
  return { start, calls: () => calls };
}

async function collectText(gen: AsyncGenerator<StreamChunk>): Promise<string> {
  let text = '';
  for await (const chunk of gen) text += chunk.text;
  return text;
}

const fast = { attempts: 3, baseDelayMs: 0 };

describe('withRetry', () => {
  it('retries a 503 and then succeeds', async () => {
    const call = flakyCall(2, 503);
    await expect(collectText(withRetry(call.start, fast))).resolves.toBe('hello world');
    expect(call.calls()).toBe(3);
  });

  it('gives up after the configured number of attempts', async () => {
    const call = flakyCall(5, 503);
    await expect(collectText(withRetry(call.start, fast))).rejects.toThrow('HTTP 503');
    expect(call.calls()).toBe(3);
  });

  it('does not retry a 400, which would fail the same way again', async () => {
    const call = flakyCall(1, 400);
    await expect(collectText(withRetry(call.start, fast))).rejects.toThrow('HTTP 400');
    expect(call.calls()).toBe(1);
  });

  it('does not retry a 429 rate limit', async () => {
    const call = flakyCall(1, 429);
    await expect(collectText(withRetry(call.start, fast))).rejects.toThrow('HTTP 429');
    expect(call.calls()).toBe(1);
  });

  it('does not retry once output has started streaming', async () => {
    let calls = 0;
    async function* start(): AsyncGenerator<StreamChunk> {
      calls++;
      yield { text: 'partial' };
      throw httpError(503);
    }
    await expect(collectText(withRetry(start, fast))).rejects.toThrow('HTTP 503');
    expect(calls).toBe(1);
  });
});
