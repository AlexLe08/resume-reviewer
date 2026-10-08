import type { CheckResult } from '@/lib/checks';
import type { CallRecord } from '@/lib/llm/usage';
import type { GroundedReview } from '@/lib/review/grounding';

/**
 * The contract between the API route and the browser. Both sides import this
 * type, so a change to the protocol is a compile error on whichever side
 * forgot to update.
 */
export type StreamEvent =
  | { type: 'extracted'; pageCount: number; text: string; checks: CheckResult[] }
  | { type: 'review_started'; personaId: string; personaName: string }
  | { type: 'review_delta'; text: string }
  | { type: 'review_done'; personaId: string; review: GroundedReview; call: CallRecord }
  | { type: 'error'; stage: 'extract' | 'review'; message: string; retryable: boolean };

export function encodeEvent(event: StreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}
