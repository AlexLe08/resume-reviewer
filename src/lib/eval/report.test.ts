import { describe, expect, it } from 'vitest';
import { formatSummary, summarize, type RunRecord } from './report';

const pass = { id: 'gap', kind: 'mention' as const, label: 'mentions gap', passed: true, detail: '' };
const fail = { ...pass, passed: false };

const RECORDS: RunRecord[] = [
  { fixture: 'a', run: 1, status: 'ok', verdict: 'yes', latencyMs: 1000, outputTokens: 100, grounding: { quotes: 4, found: 4 }, assertions: [pass] },
  { fixture: 'a', run: 2, status: 'ok', verdict: 'maybe', latencyMs: 3000, outputTokens: 300, grounding: { quotes: 4, found: 3 }, assertions: [fail] },
  { fixture: 'a', run: 3, status: 'invalid_output', error: 'bad JSON', assertions: [] },
];

describe('summarize', () => {
  const [summary] = summarize(RECORDS);

  it('counts valid runs and verdicts', () => {
    expect(summary).toMatchObject({ runs: 3, validRuns: 2, verdicts: { yes: 1, maybe: 1, no: 0 } });
  });

  it('aggregates grounding and averages over valid runs only', () => {
    expect(summary).toMatchObject({ quotes: 8, quotesFound: 7, medianLatencyMs: 2000, avgOutputTokens: 200 });
  });

  it('tallies each assertion across runs', () => {
    expect(summary?.assertions).toEqual([{ id: 'gap', kind: 'mention', label: 'mentions gap', passed: 1, total: 2 }]);
  });
});

describe('formatSummary', () => {
  it('marks partially passing checks and prints an overall line', () => {
    const text = formatSummary(summarize(RECORDS));
    expect(text).toContain('~ 1/2  mentions gap');
    expect(text).toContain('Overall: 1/2 checks passed (50%), 7/8 quotes found (88%), 2/3 valid runs');
  });
});
