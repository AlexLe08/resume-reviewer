/**
 * The demo's samples and fixed date. Pure data, so the browser can import it
 * (samples.ts reads files and can't be).
 */
/**
 * The demo's "today". Prompts and computed facts contain the date (gap and
 * tenure lengths, "Today's date is ..."), and a recording only matches a prompt
 * that is word-for-word the same, so a sample always runs as of this date.
 * Re-recording moves it forward (`npm run demo:record`).
 */
export const DEMO_TODAY = new Date('2026-10-20T12:00:00Z');

export interface DemoSample {
  id: string;
  title: string;
  /** One line on what the resume contains. It must not promise what the reviewers will say: each recording is a single real run. */
  blurb: string;
  /** A public synthetic resume in fixtures/. Never a private one. */
  file: string;
}

export const DEMO_SAMPLES: readonly DemoSample[] = [
  {
    id: 'strong-frontend',
    title: 'A strong frontend resume',
    blurb: 'Specific, quantified bullets.',
    file: 'strong-frontend.txt',
  },
  {
    id: 'weak-duties',
    title: 'A resume that lists duties',
    blurb: 'Responsibilities with no results, and a typo.',
    file: 'weak-duties.txt',
  },
  {
    id: 'skills-not-shown',
    title: 'Skills that no bullet uses',
    blurb: 'A senior title over assisting-level work, with skills that no bullet uses.',
    file: 'skills-not-shown.txt',
  },
  {
    id: 'wrong-specialty',
    title: 'Strong work, wrong specialty',
    blurb: 'Data engineering experience under a summary that says frontend.',
    file: 'wrong-specialty.txt',
  },
];

export function findSample(id: string): DemoSample | undefined {
  return DEMO_SAMPLES.find((sample) => sample.id === id);
}

/** The day the recordings were made, as shown to visitors. */
export function recordedOn(): string {
  return DEMO_TODAY.toISOString().slice(0, 10);
}
