import { describe, expect, it } from 'vitest';
import type { GroundedReview } from './grounding';
import { applyVerdictCap } from './verdict';

function review(wouldAdvance: GroundedReview['wouldAdvance'], severities: ('high' | 'medium' | 'low')[]): GroundedReview {
  return {
    summary: 's',
    wouldAdvance,
    strengths: [],
    issues: severities.map((severity) => ({ severity, problem: 'p', evidence: '', suggestion: 's', evidenceFound: true })),
    grounding: { quotes: 0, found: 0 },
  };
}

describe('applyVerdictCap', () => {
  it('lowers "yes" to "maybe" when any issue is high severity, and keeps the model\'s answer', () => {
    const capped = applyVerdictCap(review('yes', ['low', 'high']));
    expect(capped.wouldAdvance).toBe('maybe');
    expect(capped.verdictCap).toEqual({ modelVerdict: 'yes' });
  });

  it.each([
    ['yes with only medium and low issues', 'yes', ['medium', 'low']],
    ['yes with no issues', 'yes', []],
    ['maybe with a high issue', 'maybe', ['high']],
    ['no with a high issue', 'no', ['high']],
  ] as const)('leaves %s alone', (_label, verdict, severities) => {
    const input = review(verdict, [...severities]);
    expect(applyVerdictCap(input)).toBe(input);
  });
});
