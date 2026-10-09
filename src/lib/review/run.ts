import { analyzeTimeline, timelineFacts } from '@/lib/checks/timeline';
import { callStructured } from '@/lib/llm/structured';
import type { CallRecord } from '@/lib/llm/usage';
import type { ExtractedDocument } from '@/lib/pdf/extract';
import { annotateGrounding, type GroundedReview } from './grounding';
import type { Persona } from './personas';
import { buildReviewPrompt } from './prompt';
import { ReviewSchema } from './schema';

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
  const { log = true, today = new Date() } = options;
  const facts = timelineFacts(analyzeTimeline(doc.text, today));
  const { system, user } = buildReviewPrompt(persona, doc.text, today, facts);

  const outcome = await callStructured({
    task: `review:${persona.id}`,
    system,
    user,
    schema: ReviewSchema,
    temperature: 0.4,
    signal: options.signal,
    onDelta: options.onDelta,
    log,
  });
  if (!outcome.ok) return outcome;

  const review = annotateGrounding(outcome.data, doc.text);
  if (log) {
    console.info(JSON.stringify({ event: 'review_grounding', personaId: persona.id, ...review.grounding }));
  }
  return { ok: true, review, call: outcome.call };
}
