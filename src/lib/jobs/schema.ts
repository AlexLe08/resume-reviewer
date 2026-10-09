import { z } from 'zod';

export const TIERS = ['required', 'preferred', 'bonus'] as const;
export type Tier = (typeof TIERS)[number];

export const MATCH_STATUSES = ['met', 'partial', 'missing'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** What the extraction call returns. */
export const ExtractionSchema = z.object({
  requirements: z
    .array(
      z.object({
        text: z.string().describe('The requirement copied word for word from the posting.'),
        tier: z
          .enum(TIERS)
          .describe('"required" for must-haves, "preferred" for preferred qualifications, "bonus" for bonus or nice-to-have.'),
      }),
    )
    .max(40),
});

/** What the matching call returns. Requirements are referred to by number, not re-copied. */
export const MatchSchema = z.object({
  results: z.array(
    z.object({
      id: z.number().int().describe('The requirement number.'),
      status: z.enum(MATCH_STATUSES),
      evidence: z
        .string()
        .describe('A short passage copied word for word from the resume work experience, or an empty string if missing.'),
      gap: z
        .string()
        .describe('For partial or missing: briefly, what the resume does not show. Empty string if met.'),
    }),
  ),
});

export interface Requirement {
  /** 1-based, in posting order. */
  id: number;
  text: string;
  tier: Tier;
  /** False if the model reworded the requirement instead of copying it. */
  foundInPosting: boolean;
}

export interface RequirementMatch extends Requirement {
  status: MatchStatus;
  evidence: string;
  gap: string;
  /** True if the evidence appears in the resume (or there is none to check). */
  evidenceFound: boolean;
}

export interface MatchReport {
  matches: RequirementMatch[];
  /** Requirement ids the model skipped. */
  unanswered: number[];
  /** Counts per tier, computed in code rather than asked of the model. */
  counts: Record<Tier, Record<MatchStatus, number>>;
}
