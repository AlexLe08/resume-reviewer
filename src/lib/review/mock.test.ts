import { describe, expect, it } from 'vitest';
import { annotateGrounding } from './grounding';
import { buildMockReview } from './mock';
import { PERSONAS } from './personas';
import { buildReviewPrompt } from './prompt';
import { ReviewSchema } from './schema';

const RESUME = `Jordan Lee
Frontend engineer with six years of experience building design systems
Experience
Built a component library used by twelve product teams across the company
Led the migration from a legacy REST layer to typed internal services
Education and Skills: TypeScript, React, Node.js, accessibility testing`;

describe('buildMockReview', () => {
  const { user } = buildReviewPrompt(PERSONAS.recruiter, RESUME);
  const review = buildMockReview(user);

  it('matches the review schema', () => {
    expect(ReviewSchema.safeParse(review).success).toBe(true);
  });

  it('grounds every quote except the deliberately fake one', () => {
    const { grounding } = annotateGrounding(review, RESUME);
    expect(grounding.found).toBe(grounding.quotes - 1);
  });
});
