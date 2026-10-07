import { describe, expect, it } from 'vitest';
import { readNdjson } from './ndjson';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe('readNdjson', () => {
  it('handles a line split across two chunks', async () => {
    const events = await collect(readNdjson(streamOf(['{"a":', '1}\n{"b":2}\n'])));
    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('handles several lines in one chunk', async () => {
    const events = await collect(readNdjson(streamOf(['{"a":1}\n{"b":2}\n{"c":3}\n'])));
    expect(events).toHaveLength(3);
  });

  it('reads a final line with no trailing newline', async () => {
    const events = await collect(readNdjson(streamOf(['{"a":1}\n{"b":2}'])));
    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
