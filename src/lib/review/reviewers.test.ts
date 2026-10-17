import { describe, expect, it } from 'vitest';
import type { CallRecord } from '@/lib/llm/usage';
import type { StreamEvent } from '@/lib/stream/events';
import { REVIEWERS, reviewerInfo, runReviewers, type Reviewer, type ReviewerResult } from './reviewers';

const doc = { text: 'resume text', pageCount: 1 };
const call = { provider: 'mock', model: 'mock', task: 't', latencyMs: 1, inputTokens: 1, outputTokens: 1, thinkingTokens: 0, estimatedCostUsd: 0 } as CallRecord;

function fake(id: string, result: ReviewerResult | (() => ReviewerResult), delta?: string): Reviewer {
  return {
    id,
    name: id,
    kind: 'proofread',
    async run(_doc, options) {
      if (delta) options.onDelta?.(delta);
      return typeof result === 'function' ? result() : result;
    },
  };
}

async function collect(reviewers: Reviewer[], signal?: AbortSignal): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  await runReviewers(doc, reviewers, (e) => events.push(e), signal);
  return events;
}

const ok: ReviewerResult = { ok: true, kind: 'proofread', findings: [], call };

describe('runReviewers', () => {
  it('runs reviewers in order, forwards deltas with their id, and ends with done', async () => {
    const events = await collect([fake('a', ok, 'xy'), fake('b', ok)]);
    expect(events.map((e) => ('reviewerId' in e ? `${e.type}:${e.reviewerId}` : e.type))).toEqual([
      'review_started:a',
      'review_delta:a',
      'proofread_done:a',
      'review_started:b',
      'proofread_done:b',
      'done',
    ]);
  });

  it('reports a failed reviewer on that reviewer and still runs the next', async () => {
    const events = await collect([fake('a', { ok: false, kind: 'error', message: 'Model failed', retryable: true }), fake('b', ok)]);
    expect(events).toContainEqual({ type: 'reviewer_error', reviewerId: 'a', message: 'Model failed', retryable: true });
    expect(events.some((e) => e.type === 'proofread_done' && e.reviewerId === 'b')).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('stops without done when a reviewer is aborted', async () => {
    const events = await collect([fake('a', { ok: false, kind: 'aborted' }), fake('b', ok)]);
    expect(events.map((e) => e.type)).toEqual(['review_started']);
  });

  it('does not start a reviewer once the request is canceled', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await collect([fake('a', ok)], controller.signal)).toEqual([]);
  });
});

describe('REVIEWERS', () => {
  it('runs the recruiter first, then the proofreader, with unique ids', () => {
    const info = reviewerInfo(REVIEWERS);
    expect(info.map((r) => [r.id, r.kind])).toEqual([
      ['recruiter', 'review'],
      ['proofreader', 'proofread'],
    ]);
  });
});
