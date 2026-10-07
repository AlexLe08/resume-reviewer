import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from './usage';

describe('estimateCostUsd', () => {
  it('is zero on the free tier', () => {
    const usage = { inputTokens: 5000, outputTokens: 800, thinkingTokens: 1200 };
    expect(estimateCostUsd(usage, { inputPerMTok: 0, outputPerMTok: 0 })).toBe(0);
  });

  it('bills thinking tokens at the output rate', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 500_000, thinkingTokens: 500_000 };
    expect(estimateCostUsd(usage, { inputPerMTok: 1, outputPerMTok: 2 })).toBe(3);
  });
});
