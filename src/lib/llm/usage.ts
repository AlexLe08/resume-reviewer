import type { TokenUsage } from './types';

export interface CallRecord extends TokenUsage {
  provider: string;
  model: string;
  /** What the call was for, e.g. "review:recruiter" or "job:match". */
  task: string;
  latencyMs: number;
  /** What this call would cost at the configured paid-tier prices. 0 for local and free use. */
  estimatedCostUsd: number;
}

export interface Prices {
  inputPerMTok: number;
  outputPerMTok: number;
}

export function estimateCostUsd(usage: TokenUsage, prices: Prices): number {
  const input = (usage.inputTokens / 1_000_000) * prices.inputPerMTok;
  // Thinking tokens are billed at the output rate on Gemini. Check your provider's pricing page.
  const output = ((usage.outputTokens + usage.thinkingTokens) / 1_000_000) * prices.outputPerMTok;
  return Number((input + output).toFixed(6));
}

/**
 * One structured log line per model call. Console for now; Phase 4 swaps this
 * for real tracing. Never log resume content here: it's personal data.
 */
export function logCall(record: CallRecord): void {
  console.info(JSON.stringify({ event: 'llm_call', ...record }));
}
