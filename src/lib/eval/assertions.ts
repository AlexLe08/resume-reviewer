import { normalizeForMatch } from '@/lib/review/grounding';
import type { Review } from '@/lib/review/schema';
import type { Expectations } from './fixtures';

type Severity = Review['issues'][number]['severity'];
const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

export type AssertionKind = 'verdict' | 'mention' | 'no_mention' | 'evidence_source';

export interface AssertionResult {
  id: string;
  kind: AssertionKind;
  label: string;
  passed: boolean;
  detail: string;
}

/**
 * Whole-word, case-insensitive match. A trailing * makes it a prefix match.
 *
 * Keyword checks are blunt: they catch "the gap was never mentioned" reliably,
 * but can't judge whether feedback is good. That needs a model as judge, which
 * then needs its own evaluation. We start with what code can check for certain.
 */
export function containsTerm(text: string, term: string): boolean {
  const isPrefix = term.endsWith('*');
  const core = normalizeForMatch(isPrefix ? term.slice(0, -1) : term);
  if (!core) return false;
  const escaped = core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|[^a-z0-9])${escaped}${isPrefix ? '' : '(?![a-z0-9])'}`);
  return pattern.test(normalizeForMatch(text));
}

interface Passage {
  where: string;
  text: string;
  severity?: Severity;
}

/** The reviewer's own words. Evidence quotes are excluded: they're the resume's words. */
function reviewerText(review: Review): Passage[] {
  return [
    { where: 'summary', text: review.summary },
    ...review.issues.map((issue, i) => ({
      where: `issue ${i + 1} (${issue.severity})`,
      text: `${issue.problem} ${issue.suggestion}`,
      severity: issue.severity,
    })),
    ...review.strengths.map((strength, i) => ({ where: `strength ${i + 1}`, text: strength.point })),
  ];
}

export function checkExpectations(review: Review, expect: Expectations): AssertionResult[] {
  const results: AssertionResult[] = [];
  const passages = reviewerText(review);

  if (expect.verdictIn) {
    results.push({
      id: 'verdict',
      kind: 'verdict',
      label: `verdict is ${expect.verdictIn.join(' or ')}`,
      passed: expect.verdictIn.includes(review.wouldAdvance),
      detail: `verdict was ${review.wouldAdvance}`,
    });
  }

  for (const rule of expect.mustMention) {
    const pool = passages.filter((p) => {
      if (rule.minSeverity) {
        return p.severity !== undefined && SEVERITY_RANK[p.severity] >= SEVERITY_RANK[rule.minSeverity];
      }
      return rule.in === 'anywhere' || p.severity !== undefined;
    });
    const hit = pool.find((p) => rule.anyOf.some((term) => containsTerm(p.text, term)));
    results.push({
      id: rule.id,
      kind: 'mention',
      label: `mentions ${rule.id}${rule.minSeverity ? ` (${rule.minSeverity} or higher)` : ''}`,
      passed: hit !== undefined,
      detail: hit ? `found in ${hit.where}` : 'not mentioned',
    });
  }

  for (const rule of expect.mustNotMention) {
    const hit = passages.find((p) => rule.anyOf.some((term) => containsTerm(p.text, term)));
    results.push({
      id: rule.id,
      kind: 'no_mention',
      label: `never mentions ${rule.id}`,
      passed: hit === undefined,
      detail: hit ? `found in ${hit.where}` : 'not mentioned',
    });
  }

  for (const rule of expect.strengthEvidenceNotIn) {
    const span = normalizeForMatch(rule.text);
    const offenders = review.strengths
      .map((strength, i) => ({ i, evidence: normalizeForMatch(strength.evidence) }))
      .filter(({ evidence }) => evidence.length > 0 && span.includes(evidence));
    results.push({
      id: rule.id,
      kind: 'evidence_source',
      label: `strength evidence doesn't come from ${rule.id}`,
      passed: offenders.length === 0,
      detail: offenders.length ? `strength ${offenders.map((o) => o.i + 1).join(', ')} quotes it` : 'ok',
    });
  }

  return results;
}
