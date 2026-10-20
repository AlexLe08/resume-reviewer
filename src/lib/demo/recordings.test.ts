import { beforeAll, describe, expect, it } from 'vitest';
import { REVIEWERS, runReviewers } from '@/lib/review/reviewers';
import type { StreamEvent } from '@/lib/stream/events';
import { DEMO_SAMPLES, DEMO_TODAY, loadSample } from './samples';

/**
 * A recording only matches a prompt that is word-for-word the same, so changing
 * a persona, a computed fact, the schema or a sample resume leaves the demo with
 * nothing to replay. This fails the moment that happens. The fix is
 * `npm run demo:record` (see DECISIONS 7.6), then commit demo/recordings.
 */
describe('demo recordings', () => {
  beforeAll(() => {
    process.env.LLM_PROVIDER = 'replay';
    process.env.MOCK_DELAY_MS = '0';
  });

  it.each(DEMO_SAMPLES.map((s) => [s.id, s] as const))('%s has a recording for every reviewer', async (_id, sample) => {
    const events: StreamEvent[] = [];
    await runReviewers(await loadSample(sample), REVIEWERS, (e) => events.push(e), undefined, DEMO_TODAY);

    const missing = events.filter((e) => e.type === 'reviewer_error').map((e) => (e.type === 'reviewer_error' ? e.reviewerId : ''));
    expect(missing, `no recording for: ${missing.join(', ')}. Run npm run demo:record.`).toEqual([]);
    expect(events.filter((e) => e.type === 'review_done' || e.type === 'proofread_done')).toHaveLength(REVIEWERS.length);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('has no recordings that no sample uses', async () => {
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir('demo/recordings')).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(DEMO_SAMPLES.length * REVIEWERS.length);
  });
});
