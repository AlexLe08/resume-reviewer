import { describe, expect, it } from 'vitest';
import { createArrayItemReader } from './json-items';

const DOC = JSON.stringify({
  results: [
    { id: 1, text: 'Uses {braces} and [brackets] in a string', tags: ['a', 'b'] },
    { id: 2, text: 'Has "escaped quotes" and a backslash \\ here', nested: { deep: { x: 1 } } },
    { id: 3, text: '' },
  ],
  after: [{ id: 99 }],
});

function readAll(chunks: string[], key = 'results'): unknown[] {
  const reader = createArrayItemReader(key);
  return chunks.flatMap((chunk) => reader.push(chunk));
}

describe('createArrayItemReader', () => {
  it('yields every item from a document delivered in one piece', () => {
    expect(readAll([DOC]).map((item) => (item as { id: number }).id)).toEqual([1, 2, 3]);
  });

  it('gives the same items however the stream is split', () => {
    const expected = readAll([DOC]);
    for (let size = 1; size <= 12; size++) {
      const chunks: string[] = [];
      for (let i = 0; i < DOC.length; i += size) chunks.push(DOC.slice(i, i + size));
      expect(readAll(chunks)).toEqual(expected);
    }
  });

  it('yields each item as soon as it closes', () => {
    const reader = createArrayItemReader('results');
    expect(reader.push('{"results":[{"id":1}')).toEqual([{ id: 1 }]);
    expect(reader.push(',{"id":')).toEqual([]);
    expect(reader.push('2}')).toEqual([{ id: 2 }]);
  });

  it('waits for the key before reading, and ignores other arrays after the target closes', () => {
    expect(readAll(['{"other":[{"id":0}],', '"results":[{"id":1}],"after":[{"id":2}]}'])).toEqual([{ id: 1 }]);
  });
});
