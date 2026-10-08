import type { Review } from './schema';

const FAKE_QUOTE = 'This sentence does not appear anywhere in the resume.';

/**
 * A deterministic review for the mock provider. Evidence is lifted from the
 * resume itself so the grounding check passes, except for one deliberately
 * fake quote that exercises the "not found" warning in the UI.
 */
export function buildMockReview(userPrompt: string): Review {
  const resume = userPrompt.match(/<resume>\n?([\s\S]*?)\n?<\/resume>/)?.[1] ?? '';
  const lines = resume
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 30);
  const quote = (index: number) => firstWords(lines[index] ?? lines[0] ?? '', 10);

  return {
    summary:
      'Mock review for UI development. No model was called. Quotes are taken from your resume so the grounding check has real text to match.',
    wouldAdvance: 'maybe',
    strengths: [
      { point: '[Mock] A strength backed by a real quote.', evidence: quote(1) },
      { point: '[Mock] Another strength backed by a real quote.', evidence: quote(3) },
    ],
    issues: [
      {
        severity: 'high',
        problem: '[Mock] A high-severity issue with a real quote.',
        evidence: quote(2),
        suggestion: 'Example suggestion text.',
      },
      {
        severity: 'medium',
        problem: '[Mock] An issue about something missing, so it has no quote.',
        evidence: '',
        suggestion: 'Example suggestion text.',
      },
      {
        severity: 'low',
        problem: '[Mock] An issue whose quote is invented, to show the warning style.',
        evidence: FAKE_QUOTE,
        suggestion: 'Example suggestion text.',
      },
    ],
  };
}

function firstWords(line: string, count: number): string {
  return line.split(/\s+/).slice(0, count).join(' ');
}
