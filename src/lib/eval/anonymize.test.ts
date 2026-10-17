import { describe, expect, it } from 'vitest';
import { AnonymizeMapSchema, mapProblems, replaceNames } from './anonymize';

const map = { Acme: 'CompanyA', 'Acme Labs': 'CompanyB' };

describe('replaceNames', () => {
  it('replaces whole words, keeps lowercase forms lowercase, and handles possessives', () => {
    const { text, counts } = replaceNames("Acme's team. Mail hr@acme.com or ACME. Acmeology stays.", map);
    expect(text).toBe("CompanyA's team. Mail hr@companya.com or CompanyA. Acmeology stays.");
    expect(counts).toEqual({ Acme: 3 });
  });
  it('prefers the longest name', () => {
    expect(replaceNames('Acme Labs and Acme', map).text).toBe('CompanyB and CompanyA');
  });
  it('is stable when run twice', () => {
    const once = replaceNames('Acme Labs', map).text;
    expect(replaceNames(once, map).text).toBe(once);
  });
});

describe('mapProblems', () => {
  it('flags placeholders that would be re-replaced or break JSON', () => {
    expect(mapProblems(AnonymizeMapSchema.parse({ replacements: { Acme: 'Acme Two' } })).length).toBeGreaterThan(0);
    expect(mapProblems(AnonymizeMapSchema.parse({ replacements: { Acme: 'Co "A"' } })).length).toBeGreaterThan(0);
    expect(mapProblems(AnonymizeMapSchema.parse({ replacements: map }))).toEqual([]);
  });
  it('rejects names too short to be safe', () => {
    expect(AnonymizeMapSchema.safeParse({ replacements: { Go: 'X' } }).success).toBe(false);
  });
});
