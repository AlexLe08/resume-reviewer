import path from 'node:path';
import { loadResume } from '@/lib/eval/fixtures';
import type { ExtractedDocument } from '@/lib/pdf/extract';
import type { DemoSample } from './catalog';

export { DEMO_SAMPLES, DEMO_TODAY, findSample, recordedOn, type DemoSample } from './catalog';

/** Reads a sample from the public fixtures folder (the only place samples live). */
export async function loadSample(sample: DemoSample, root = process.cwd()): Promise<ExtractedDocument> {
  if (sample.file !== path.basename(sample.file)) throw new Error(`Sample file "${sample.file}" must be a plain file name in fixtures/.`);
  return loadResume(path.join(root, 'fixtures', sample.file));
}
