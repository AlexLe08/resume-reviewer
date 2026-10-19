import type { GroundedReview } from './grounding';

/**
 * A "yes" next to a high-severity issue contradicts itself, and the model does
 * it: DECISIONS 7.3 (the hiring manager called a frontend-versus-data mismatch
 * high severity in 3 of 3 runs and still said "yes"). Code settles it: a review
 * that raises a high-severity issue cannot say "yes". The cap only lowers, and
 * it leaves "maybe" and "no" alone. The model's own answer stays on the review.
 */
export function applyVerdictCap(review: GroundedReview): GroundedReview {
  if (review.wouldAdvance !== 'yes' || !review.issues.some((issue) => issue.severity === 'high')) return review;
  return { ...review, wouldAdvance: 'maybe', verdictCap: { modelVerdict: 'yes' } };
}
