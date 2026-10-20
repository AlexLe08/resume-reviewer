import path from 'node:path';
import { loadResume } from '@/lib/eval/fixtures';
import type { ExtractedDocument } from '@/lib/pdf/extract';

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

/** Reads a sample from the public fixtures folder (the only place samples live). */
export async function loadSample(sample: DemoSample, root = process.cwd()): Promise<ExtractedDocument> {
  if (sample.file !== path.basename(sample.file)) throw new Error(`Sample file "${sample.file}" must be a plain file name in fixtures/.`);
  return loadResume(path.join(root, 'fixtures', sample.file));
}
