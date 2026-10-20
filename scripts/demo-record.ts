/**
 * Records real model answers for the demo's sample resumes, so the hosted demo
 * can replay them (LLM_PROVIDER=replay) with no model behind it.
 *
 *   npm run demo:record                     all samples; clears demo/recordings first
 *   npm run demo:record -- --only wrong-specialty   one sample; keeps the other recordings
 *
 * It runs the real pipeline (recruiter, hiring manager, proofreader) through the
 * same runReviewers the app uses, as of DEMO_TODAY, on whichever real provider
 * is configured. One run per sample, kept as it came: no picking the best of
 * several. Samples are public synthetic resumes only.
 */
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEMO_SAMPLES, DEMO_TODAY, findSample, loadSample } from '@/lib/demo/samples';
import { getEnv } from '@/lib/env';
import { modelName, providerName } from '@/lib/llm';
import { REVIEWERS, runReviewers } from '@/lib/review/reviewers';
import type { StreamEvent } from '@/lib/stream/events';
import { loadLocalEnv } from './lib/run';

async function main(): Promise<void> {
  loadLocalEnv();
  const { values } = parseArgs({ options: { only: { type: 'string' } } });

  const provider = process.env.LLM_PROVIDER ?? 'ollama';
  if (provider === 'mock' || provider === 'replay') {
    throw new Error(`LLM_PROVIDER=${provider} would record nothing real. Use ollama (the default) or gemini.`);
  }
  const dir = path.resolve(process.env.LLM_RECORDINGS_DIR ?? 'demo/recordings');
  // Set before anything reads the settings (they are cached on first read).
  process.env.LLM_RECORD_TO = dir;

  const samples = values.only ? [findSample(values.only)].filter((s) => s !== undefined) : DEMO_SAMPLES;
  if (samples.length === 0) throw new Error(`No sample "${values.only}". Options: ${DEMO_SAMPLES.map((s) => s.id).join(', ')}.`);

  // Load every sample before any model call: a broken one should fail now, not halfway through.
  const docs = await Promise.all(samples.map(async (sample) => ({ sample, doc: await loadSample(sample) })));

  if (!values.only) {
    // A full re-record starts clean, so recordings for old prompts don't pile up.
    for (const name of await readdir(dir).catch(() => [])) if (name.endsWith('.json')) await rm(path.join(dir, name));
  }
  getEnv();
  console.log(`Recording ${docs.length} sample(s) with ${providerName()} / ${modelName()}, as of ${DEMO_TODAY.toISOString().slice(0, 10)} → ${path.relative(process.cwd(), dir)}\n`);

  let failures = 0;
  for (const { sample, doc } of docs) {
    console.log(`  ${sample.id}`);
    const events: StreamEvent[] = [];
    await runReviewers(doc, REVIEWERS, (e) => events.push(e), undefined, DEMO_TODAY);
    for (const reviewer of REVIEWERS) {
      const done = events.find((e) => (e.type === 'review_done' || e.type === 'proofread_done') && e.reviewerId === reviewer.id);
      const failed = events.find((e) => e.type === 'reviewer_error' && e.reviewerId === reviewer.id);
      if (done && (done.type === 'review_done' || done.type === 'proofread_done')) {
        console.log(`    ${reviewer.id.padEnd(15)} ${(done.call.latencyMs / 1000).toFixed(1)} s`);
      } else {
        failures++;
        console.log(`    ${reviewer.id.padEnd(15)} FAILED${failed && failed.type === 'reviewer_error' ? `: ${failed.message}` : ''}`);
      }
    }
  }
  if (failures > 0) {
    throw new Error(`${failures} reviewer run(s) failed, so the demo would be missing recordings. Run again.`);
  }
  console.log(`\nDone. Check the files with git status, then commit demo/recordings.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
