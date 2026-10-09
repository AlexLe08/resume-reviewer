import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONAS } from './personas';
import { runReview } from './run';

// An end-to-end test of the shared pipeline, with the mock provider standing in
// for a model: prompt → streamed JSON → validation → grounding. Each test file
// gets fresh modules, so setting env here doesn't leak into other tests.
beforeAll(() => {
  process.env.LLM_PROVIDER = 'mock';
  process.env.MOCK_DELAY_MS = '0';
});

const DOC = {
  pageCount: 1,
  text: `Jordan Lee
Frontend engineer with six years of experience building design systems
Built a component library used by twelve product teams across the company
Led the migration from a legacy REST layer to typed internal services
Education and Skills: TypeScript, React, Node.js, accessibility testing`,
};

describe('runReview', () => {
  it('produces a validated, grounded review and streams text along the way', async () => {
    let streamed = '';
    const outcome = await runReview(DOC, PERSONAS.recruiter, {
      log: false,
      onDelta: (text) => (streamed += text),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(streamed.length).toBeGreaterThan(0);
    expect(outcome.call).toMatchObject({ provider: 'mock', model: 'mock', task: 'review:recruiter' });
    // The mock includes exactly one invented quote.
    expect(outcome.review.grounding.found).toBe(outcome.review.grounding.quotes - 1);
  });

  it('reports an aborted run without treating it as an error', async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await runReview(DOC, PERSONAS.recruiter, { log: false, signal: controller.signal });
    expect(outcome).toEqual({ ok: false, kind: 'aborted' });
  });
});
