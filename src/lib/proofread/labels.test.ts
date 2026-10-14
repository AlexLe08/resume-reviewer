import { describe, expect, it } from 'vitest';
import { validateLabels } from './labels';

const doc = { text: 'Led the bookign flow.\nMentored 4 engineers; the flow ships.', pageCount: 1 };
const item = (over: object) => ({ id: 'a', kind: 'nonword' as const, text: 'bookign', context: 'the bookign flow', ...over });

describe('validateLabels', () => {
  it('accepts a label whose context is in the text once', () => {
    expect(validateLabels([item({})], doc)).toEqual([]);
  });
  it('rejects a missing context, a repeated context, a text outside its context and duplicate ids', () => {
    expect(validateLabels([item({ context: 'not there' })], doc)[0]).toMatch(/isn't in the resume/);
    expect(validateLabels([item({ text: 'flow', context: 'flow' })], doc).join()).toMatch(/more than once/);
    expect(validateLabels([item({ text: 'Mentored' })], doc).join()).toMatch(/isn't inside its context/);
    expect(validateLabels([item({}), item({})], doc).join()).toMatch(/used twice/);
  });
});
