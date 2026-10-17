import type { CheckResult } from '@/lib/checks';
import type { CallRecord } from '@/lib/llm/usage';
import type { ProofreadFinding } from '@/lib/proofread/model';
import type { GroundedReview } from '@/lib/review/grounding';

/** What a reviewer produces: a review (verdict, strengths, issues) or a list of corrections. */
export type ReviewerKind = 'review' | 'proofread';

export interface ReviewerInfo {
  id: string;
  name: string;
  kind: ReviewerKind;
}

/**
 * The contract between the API route and the browser. Both sides import this
 * type, so a change to the protocol is a compile error on whichever side
 * forgot to update.
 *
 * extracted → per reviewer, one after another:
 *   review_started → review_delta* → review_done | proofread_done | reviewer_error
 * → done. `error` is fatal and ends the stream; `reviewer_error` ends one
 * reviewer only, and the others still run.
 */
export type StreamEvent =
  /** Lists every reviewer up front, so the browser can show them before any has started. */
  | { type: 'extracted'; pageCount: number; text: string; checks: CheckResult[]; reviewers: ReviewerInfo[] }
  | { type: 'review_started'; reviewerId: string }
  | { type: 'review_delta'; reviewerId: string; text: string }
  | { type: 'review_done'; reviewerId: string; review: GroundedReview; call: CallRecord }
  | { type: 'proofread_done'; reviewerId: string; findings: ProofreadFinding[]; call: CallRecord }
  | { type: 'reviewer_error'; reviewerId: string; message: string; retryable: boolean }
  | { type: 'done' }
  | { type: 'error'; stage: 'extract' | 'review'; message: string; retryable: boolean };

export function encodeEvent(event: StreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}
