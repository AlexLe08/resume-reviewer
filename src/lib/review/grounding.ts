import type { Review } from './schema';

type WithGrounding<T> = T & { evidenceFound: boolean };

export interface GroundedReview extends Omit<Review, 'strengths' | 'issues'> {
  strengths: WithGrounding<Review['strengths'][number]>[];
  issues: WithGrounding<Review['issues'][number]>[];
  /** How many quotes were checked, and how many appear in the resume. */
  grounding: { quotes: number; found: number };
}

/**
 * Smooths over differences that don't change meaning: PDF line wraps, curly
 * vs straight quotes, dash styles, bullet glyphs, case, trailing punctuation.
 * Anything beyond that (different words) counts as not found.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u25CF\u2022\u25AA\u25E6]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:]+$/, '');
}

export function isQuoteInText(quote: string, sourceText: string): boolean {
  const needle = normalizeForMatch(quote);
  if (!needle) return true; // Empty evidence ("something is missing") claims no quote.
  return normalizeForMatch(sourceText).includes(needle);
}

export function annotateGrounding(review: Review, sourceText: string): GroundedReview {
  const check = <T extends { evidence: string }>(item: T): WithGrounding<T> => ({
    ...item,
    evidenceFound: isQuoteInText(item.evidence, sourceText),
  });

  const strengths = review.strengths.map(check);
  const issues = review.issues.map(check);
  const quoted = [...strengths, ...issues].filter((item) => item.evidence.trim() !== '');

  return {
    ...review,
    strengths,
    issues,
    grounding: {
      quotes: quoted.length,
      found: quoted.filter((item) => item.evidenceFound).length,
    },
  };
}
