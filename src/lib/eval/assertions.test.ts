import { describe, expect, it } from 'vitest';
import type { Review } from '@/lib/review/schema';
import { checkExpectations, containsTerm } from './assertions';
import { ExpectationsSchema } from './fixtures';

describe('containsTerm', () => {
  it('matches whole words, ignoring case', () => {
    expect(containsTerm('There is an employment Gap here.', 'gap')).toBe(true);
  });

  it('does not match inside other words', () => {
    expect(containsTerm('Boosted engagement on the homepage', 'age')).toBe(false);
  });

  it('treats a trailing * as a prefix match', () => {
    expect(containsTerm('Quantified results are missing', 'quantif*')).toBe(true);
    expect(containsTerm('Quantified results are missing', 'quantif')).toBe(false);
  });
});

const REVIEW: Review = {
  summary: 'Solid experience, but the summary is vague.',
  wouldAdvance: 'maybe',
  strengths: [
    { point: 'Clear impact', evidence: 'cut data delay from 24 hours to under 5 minutes' },
    { point: 'Strong positioning', evidence: 'Results-driven, visionary full-stack thought leader' },
  ],
  issues: [
    { severity: 'medium', problem: 'Summary relies on buzzwords.', evidence: '', suggestion: 'Rewrite it.' },
    { severity: 'low', problem: 'There is a short gap.', evidence: '', suggestion: 'Explain it.' },
  ],
};

describe('checkExpectations', () => {
  it('checks the verdict', () => {
    const [result] = checkExpectations(REVIEW, ExpectationsSchema.parse({ verdictIn: ['no'] }));
    expect(result).toMatchObject({ kind: 'verdict', passed: false, detail: 'verdict was maybe' });
  });

  it('finds a required mention in the issues', () => {
    const [result] = checkExpectations(
      REVIEW,
      ExpectationsSchema.parse({ mustMention: [{ id: 'buzzwords', anyOf: ['buzzword*'] }] }),
    );
    expect(result).toMatchObject({ passed: true, detail: 'found in issue 1 (medium)' });
  });

  it('ignores issues below the minimum severity', () => {
    const [result] = checkExpectations(
      REVIEW,
      ExpectationsSchema.parse({ mustMention: [{ id: 'gap', anyOf: ['gap'], minSeverity: 'medium' }] }),
    );
    expect(result?.passed).toBe(false);
  });

  it('only searches the summary when asked to look anywhere', () => {
    const rule = { id: 'vague', anyOf: ['vague'] };
    const [inIssues] = checkExpectations(REVIEW, ExpectationsSchema.parse({ mustMention: [rule] }));
    const [anywhere] = checkExpectations(
      REVIEW,
      ExpectationsSchema.parse({ mustMention: [{ ...rule, in: 'anywhere' }] }),
    );
    expect(inIssues?.passed).toBe(false);
    expect(anywhere?.passed).toBe(true);
  });

  it('flags forbidden mentions but ignores evidence quotes', () => {
    const [result] = checkExpectations(
      REVIEW,
      ExpectationsSchema.parse({ mustNotMention: [{ id: 'visionary', anyOf: ['visionary'] }] }),
    );
    expect(result?.passed).toBe(true);
  });

  it('flags strengths whose evidence comes from a forbidden passage', () => {
    const [result] = checkExpectations(
      REVIEW,
      ExpectationsSchema.parse({
        strengthEvidenceNotIn: [
          { id: 'summary', text: 'Results-driven, visionary full-stack thought leader and passionate innovator.' },
        ],
      }),
    );
    expect(result).toMatchObject({ passed: false, detail: 'strength 2 quotes it' });
  });
});
