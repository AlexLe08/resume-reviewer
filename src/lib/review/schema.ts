import { z } from 'zod';

/**
 * The single source of truth for a review's shape. We use it twice:
 *  1. Converted to JSON Schema and sent to the model, so the API constrains
 *     its output to this shape.
 *  2. To validate what comes back, because "the API promised" is not the same
 *     as "we checked". Anything crossing a trust boundary gets validated.
 */
export const ReviewSchema = z.object({
  summary: z
    .string()
    .describe("Two or three sentences giving your overall impression, in your reviewer role's voice."),
  wouldAdvance: z
    .enum(['yes', 'maybe', 'no'])
    .describe('Based on the resume alone, would you move this candidate to the next round?'),
  strengths: z
    .array(
      z.object({
        point: z.string().describe('What works, stated specifically.'),
        evidence: z
          .string()
          .describe('A short quote copied word-for-word from the resume that supports this point.'),
      }),
    )
    .max(5),
  issues: z
    .array(
      z.object({
        severity: z.enum(['high', 'medium', 'low']),
        problem: z.string().describe('What is wrong, stated specifically.'),
        evidence: z
          .string()
          .describe(
            'A short quote copied word-for-word from the resume, or an empty string if the problem is something missing.',
          ),
        suggestion: z.string().describe('A concrete change the candidate can make.'),
      }),
    )
    .max(8),
});

export type Review = z.infer<typeof ReviewSchema>;
