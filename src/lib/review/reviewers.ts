import type { CallRecord } from '@/lib/llm/usage';
import type { ExtractedDocument } from '@/lib/pdf/extract';
import { runProofread, type ProofreadFinding } from '@/lib/proofread/model';
import type { ReviewerInfo, StreamEvent } from '@/lib/stream/events';
import type { GroundedReview } from './grounding';
import { PERSONAS, type Persona } from './personas';
import { runReview } from './run';

export type ReviewerResult =
  | { ok: true; kind: 'review'; review: GroundedReview; call: CallRecord }
  | { ok: true; kind: 'proofread'; findings: ProofreadFinding[]; call: CallRecord }
  | { ok: false; kind: 'aborted' }
  | { ok: false; kind: 'error'; message: string; retryable: boolean };

export interface ReviewerRunOptions {
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  /** Defaults to now. The demo passes a fixed date so its recorded prompts keep matching. */
  today?: Date;
}

export interface Reviewer extends ReviewerInfo {
  run(doc: ExtractedDocument, options: ReviewerRunOptions): Promise<ReviewerResult>;
}

/**
 * Every reviewer the app runs, in the order they run. Persona reviewers are
 * data plus the shared review pipeline; the proofreader has its own pipeline
 * because it returns corrections, not a verdict.
 */
function personaReviewer(persona: Persona): Reviewer {
  return {
    id: persona.id,
    name: persona.name,
    kind: 'review',
    async run(doc, options) {
      const outcome = await runReview(doc, persona, options);
      if (outcome.ok) return { ok: true, kind: 'review', review: outcome.review, call: outcome.call };
      if (outcome.kind === 'aborted') return outcome;
      return { ok: false, kind: 'error', message: outcome.message, retryable: outcome.kind === 'llm_error' ? outcome.retryable : true };
    },
  };
}

export const REVIEWERS: readonly Reviewer[] = [
  personaReviewer(PERSONAS.recruiter),
  personaReviewer(PERSONAS['hiring-manager']),
  {
    id: 'proofreader',
    name: 'Proofreader',
    kind: 'proofread',
    async run(doc, options) {
      const outcome = await runProofread(doc.text, options);
      if (outcome.ok) return { ok: true, kind: 'proofread', findings: outcome.findings, call: outcome.call };
      if (outcome.kind === 'aborted') return { ok: false, kind: 'aborted' };
      return { ok: false, kind: 'error', message: outcome.message, retryable: outcome.retryable };
    },
  },
];

export const reviewerInfo = (reviewers: readonly Reviewer[]): ReviewerInfo[] =>
  reviewers.map(({ id, name, kind }) => ({ id, name, kind }));

/**
 * Runs the reviewers one after another (the local model handles one request at
 * a time) and reports each as soon as it finishes. One reviewer failing is
 * reported on that reviewer and the next still runs. Returns without `done`
 * if the request was canceled.
 */
export async function runReviewers(
  doc: ExtractedDocument,
  reviewers: readonly Reviewer[],
  send: (event: StreamEvent) => void,
  signal?: AbortSignal,
  today?: Date,
): Promise<void> {
  for (const reviewer of reviewers) {
    if (signal?.aborted) return;
    send({ type: 'review_started', reviewerId: reviewer.id });
    const result = await reviewer.run(doc, {
      signal,
      today,
      onDelta: (text) => send({ type: 'review_delta', reviewerId: reviewer.id, text }),
    });

    if (!result.ok) {
      if (result.kind === 'aborted') return;
      send({ type: 'reviewer_error', reviewerId: reviewer.id, message: result.message, retryable: result.retryable });
    } else if (result.kind === 'review') {
      send({ type: 'review_done', reviewerId: reviewer.id, review: result.review, call: result.call });
    } else {
      send({ type: 'proofread_done', reviewerId: reviewer.id, findings: result.findings, call: result.call });
    }
  }
  send({ type: 'done' });
}
