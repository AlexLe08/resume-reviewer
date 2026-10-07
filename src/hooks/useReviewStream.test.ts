import { describe, expect, it } from 'vitest';
import { initialReviewState, reduceEvent } from './useReviewStream';

describe('reduceEvent', () => {
  it('moves to reviewing once text is extracted', () => {
    const next = reduceEvent(initialReviewState, {
      type: 'extracted',
      pageCount: 1,
      text: 'resume text',
      checks: [],
    });
    expect(next.status).toBe('reviewing');
    expect(next.extracted?.pageCount).toBe(1);
  });

  it('counts streamed characters', () => {
    let state = reduceEvent(initialReviewState, { type: 'review_delta', text: 'abc' });
    state = reduceEvent(state, { type: 'review_delta', text: 'de' });
    expect(state.liveChars).toBe(5);
  });

  it('keeps extracted text when an error arrives', () => {
    const withText = reduceEvent(initialReviewState, {
      type: 'extracted',
      pageCount: 1,
      text: 'resume text',
      checks: [],
    });
    const failed = reduceEvent(withText, {
      type: 'error',
      stage: 'review',
      message: 'Rate limited',
      retryable: true,
    });
    expect(failed.status).toBe('error');
    expect(failed.extracted?.text).toBe('resume text');
  });
});
