import { describe, expect, it } from 'vitest';
import { annotateGrounding, isQuoteInText } from './grounding';
import type { Review } from './schema';

const SOURCE = `● Designed type-ahead
filtering that doubled conversion and lifted engagement by 7%.
● Cut payload sizes by 20% – improving “Time-to-Interactive”.`;

describe('isQuoteInText', () => {
  it('matches across a PDF line wrap', () => {
    expect(isQuoteInText('type-ahead filtering that doubled conversion', SOURCE)).toBe(true);
  });

  it('ignores dash style, curly quotes, case, and trailing punctuation', () => {
    expect(isQuoteInText('cut payload sizes by 20% - improving "time-to-interactive".', SOURCE)).toBe(true);
  });

  it('rejects a paraphrase', () => {
    expect(isQuoteInText('reduced payload sizes by 20%', SOURCE)).toBe(false);
  });

  it('rejects a quote stitched from two bullets', () => {
    expect(isQuoteInText('lifted engagement by 7% and cut payload sizes by 20%', SOURCE)).toBe(false);
  });

  it('treats empty evidence as nothing to verify', () => {
    expect(isQuoteInText('', SOURCE)).toBe(true);
  });
});

describe('annotateGrounding', () => {
  it('counts only non-empty quotes', () => {
    const review: Review = {
      summary: 's',
      wouldAdvance: 'maybe',
      strengths: [{ point: 'p', evidence: 'doubled conversion' }],
      issues: [
        { severity: 'low', problem: 'p', evidence: 'invented quote', suggestion: 's' },
        { severity: 'low', problem: 'missing thing', evidence: '', suggestion: 's' },
      ],
    };
    const result = annotateGrounding(review, SOURCE);
    expect(result.grounding).toEqual({ quotes: 2, found: 1 });
    expect(result.issues[0]?.evidenceFound).toBe(false);
  });
});
