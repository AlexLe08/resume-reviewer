import { describe, expect, it } from 'vitest';
import type { CallRecord } from '@/lib/llm/usage';
import type { StreamEvent } from '@/lib/stream/events';
import { initialReviewState, reduceEvent, reviewForm, type ReviewState } from './useReviewStream';

const call = { provider: 'mock', model: 'mock', task: 't', latencyMs: 1, inputTokens: 1, outputTokens: 1, thinkingTokens: 0, estimatedCostUsd: 0 } as CallRecord;
const extracted: StreamEvent = {
  type: 'extracted',
  pageCount: 1,
  text: 'resume text',
  checks: [],
  reviewers: [
    { id: 'recruiter', name: 'Recruiter', kind: 'review' },
    { id: 'proofreader', name: 'Proofreader', kind: 'proofread' },
  ],
};
const run = (events: StreamEvent[], from: ReviewState = initialReviewState) => events.reduce(reduceEvent, from);
const reviewer = (state: ReviewState, id: string) => state.reviewers.find((r) => r.id === id)!;

describe('reduceEvent', () => {
  it('lists every reviewer as waiting once text is extracted', () => {
    const state = run([extracted]);
    expect(state.status).toBe('reviewing');
    expect(state.extracted?.pageCount).toBe(1);
    expect(state.reviewers.map((r) => [r.id, r.status])).toEqual([
      ['recruiter', 'waiting'],
      ['proofreader', 'waiting'],
    ]);
  });

  it('counts streamed characters for the reviewer they belong to', () => {
    const state = run([
      extracted,
      { type: 'review_started', reviewerId: 'recruiter' },
      { type: 'review_delta', reviewerId: 'recruiter', text: 'abc' },
      { type: 'review_delta', reviewerId: 'recruiter', text: 'de' },
    ]);
    expect(reviewer(state, 'recruiter')).toMatchObject({ status: 'running', liveChars: 5 });
    expect(reviewer(state, 'proofreader')).toMatchObject({ status: 'waiting', liveChars: 0 });
  });

  it('keeps finished reviewers when a later one fails, and finishes the request', () => {
    const state = run([
      extracted,
      { type: 'proofread_done', reviewerId: 'recruiter', findings: [], call },
      { type: 'reviewer_error', reviewerId: 'proofreader', message: 'Model failed', retryable: true },
      { type: 'done' },
    ]);
    expect(state.status).toBe('done');
    expect(reviewer(state, 'recruiter').status).toBe('done');
    expect(reviewer(state, 'proofreader')).toMatchObject({ status: 'error', error: 'Model failed' });
  });

  it('stores findings and the call for a proofreader', () => {
    const state = run([extracted, { type: 'proofread_done', reviewerId: 'proofreader', findings: [], call }]);
    expect(reviewer(state, 'proofreader')).toMatchObject({ status: 'done', findings: [], call });
  });

  it('keeps extracted text on a fatal error and stops reviewers that never finished', () => {
    const state = run([
      extracted,
      { type: 'proofread_done', reviewerId: 'recruiter', findings: [], call },
      { type: 'error', stage: 'review', message: 'Rate limited', retryable: true },
    ]);
    expect(state.status).toBe('error');
    expect(state.extracted?.text).toBe('resume text');
    expect(reviewer(state, 'recruiter').status).toBe('done');
    expect(reviewer(state, 'proofreader')).toMatchObject({ status: 'error', error: 'Rate limited' });
  });
});

describe('reviewForm', () => {
  it('sends an uploaded file as the resume field', () => {
    const file = new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' });
    const body = reviewForm(file);
    expect(body.get('resume')).toBeInstanceOf(File);
    expect(body.has('sample')).toBe(false);
  });

  it('sends a demo sample as its id and no file', () => {
    const body = reviewForm({ sample: 'weak-duties' });
    expect(body.get('sample')).toBe('weak-duties');
    expect(body.has('resume')).toBe(false);
  });
});
