import {
  currentPrices,
  describeLlmError,
  modelName,
  providerName,
  streamStructured,
  type TokenUsage,
} from '@/lib/llm';
import { estimateCostUsd, logCall, type CallRecord } from '@/lib/llm/usage';
import { analyzeTimeline, timelineFacts } from '@/lib/checks/timeline';
import type { ExtractedDocument } from '@/lib/pdf/extract';
import { annotateGrounding, type GroundedReview } from './grounding';
import type { Persona } from './personas';
import { buildReviewPrompt } from './prompt';
import { parseReview, reviewJsonSchema } from './schema';

export type ReviewOutcome =
  | { ok: true; review: GroundedReview; call: CallRecord }
  | { ok: false; kind: 'aborted' }
  | { ok: false; kind: 'llm_error'; message: string; retryable: boolean }
  | { ok: false; kind: 'invalid_output'; message: string; reason: string; call: CallRecord };

export interface RunReviewOptions {
  signal?: AbortSignal;
  /** Called with each piece of streamed text, e.g. to forward it to the browser. */
  onDelta?: (text: string) => void;
  /** Write structured log lines. The eval runner turns this off to keep its output readable. */
  log?: boolean;
  /** Defaults to now. Tests pass a fixed date. */
  today?: Date;
}

/**
 * The complete review pipeline for one persona: prompt, model call, validation,
 * grounding. The API route and the eval runner both call this, so evals measure
 * exactly what ships. If evals had their own copy of this logic, a passing eval
 * would prove nothing about production.
 */
export async function runReview(
  doc: ExtractedDocument,
  persona: Persona,
  options: RunReviewOptions = {},
): Promise<ReviewOutcome> {
  const { signal, onDelta, log = true, today = new Date() } = options;
  const facts = timelineFacts(analyzeTimeline(doc.text, today));
  const { system, user } = buildReviewPrompt(persona, doc.text, today, facts);
  const started = performance.now();
  let raw = '';
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
  let servedModel: string | undefined;

  try {
    const chunks = streamStructured({
      system,
      user,
      jsonSchema: reviewJsonSchema(),
      temperature: 0.4,
      signal,
    });
    for await (const chunk of chunks) {
      if (chunk.text) {
        raw += chunk.text;
        onDelta?.(chunk.text);
      }
      if (chunk.usage) usage = chunk.usage;
      if (chunk.model) servedModel = chunk.model;
    }
  } catch (err) {
    if (signal?.aborted) return { ok: false, kind: 'aborted' };
    if (log) console.error('llm_call_failed', err instanceof Error ? err.message : err);
    return { ok: false, kind: 'llm_error', ...describeLlmError(err) };
  }

  const call: CallRecord = {
    provider: providerName(),
    model: servedModel ?? modelName(),
    personaId: persona.id,
    latencyMs: Math.round(performance.now() - started),
    ...usage,
    estimatedCostUsd: estimateCostUsd(usage, currentPrices()),
  };
  // Log before validating, so failed calls still show up in usage numbers.
  if (log) logCall(call);

  const parsed = parseReview(raw);
  if (!parsed.success) {
    if (log) console.error('review_validation_failed', parsed.reason);
    return {
      ok: false,
      kind: 'invalid_output',
      message: 'The reviewer returned an incomplete result. Try again.',
      reason: parsed.reason,
      call,
    };
  }

  const review = annotateGrounding(parsed.data, doc.text);
  if (log) {
    console.info(JSON.stringify({ event: 'review_grounding', personaId: persona.id, ...review.grounding }));
  }
  return { ok: true, review, call };
}
