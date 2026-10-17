'use client';

import { useCallback } from 'react';
import type { CheckResult } from '@/lib/checks';
import type { CallRecord } from '@/lib/llm/usage';
import type { ProofreadFinding } from '@/lib/proofread/model';
import type { GroundedReview } from '@/lib/review/grounding';
import type { ReviewerInfo, StreamEvent } from '@/lib/stream/events';
import { useNdjsonRequest } from './useNdjsonRequest';

export type ReviewStatus = 'idle' | 'extracting' | 'reviewing' | 'done' | 'error';

/** waiting: not started yet. Reviewers run one after another. */
export type ReviewerStatus = 'waiting' | 'running' | 'done' | 'error';

export interface ReviewerState extends ReviewerInfo {
  status: ReviewerStatus;
  /** How much of the output has streamed in so far. Drives the progress text. */
  liveChars: number;
  review?: GroundedReview;
  findings?: ProofreadFinding[];
  call?: CallRecord;
  error?: string;
}

export interface ReviewState {
  status: ReviewStatus;
  extracted?: { text: string; pageCount: number; checks: CheckResult[] };
  /** In the order they run. */
  reviewers: ReviewerState[];
  /** A failure of the whole request. One reviewer failing is on that reviewer. */
  error?: string;
}

export const initialReviewState: ReviewState = { status: 'idle', reviewers: [] };

function updateReviewer(state: ReviewState, id: string, change: (r: ReviewerState) => ReviewerState): ReviewState {
  return { ...state, reviewers: state.reviewers.map((r) => (r.id === id ? change(r) : r)) };
}

/**
 * Pure function: (state, event) → new state. Keeping it separate from the
 * fetch logic means it can be unit tested without a network or a browser.
 */
export function reduceEvent(state: ReviewState, event: StreamEvent): ReviewState {
  switch (event.type) {
    case 'extracted':
      return {
        ...state,
        status: 'reviewing',
        extracted: { text: event.text, pageCount: event.pageCount, checks: event.checks },
        reviewers: event.reviewers.map((r) => ({ ...r, status: 'waiting', liveChars: 0 })),
      };
    case 'review_started':
      return updateReviewer(state, event.reviewerId, (r) => ({ ...r, status: 'running' }));
    case 'review_delta':
      return updateReviewer(state, event.reviewerId, (r) => ({ ...r, liveChars: r.liveChars + event.text.length }));
    case 'review_done':
      return updateReviewer(state, event.reviewerId, (r) => ({ ...r, status: 'done', review: event.review, call: event.call }));
    case 'proofread_done':
      return updateReviewer(state, event.reviewerId, (r) => ({ ...r, status: 'done', findings: event.findings, call: event.call }));
    case 'reviewer_error':
      return updateReviewer(state, event.reviewerId, (r) => ({ ...r, status: 'error', error: event.message }));
    case 'done':
      return { ...state, status: 'done' };
    case 'error':
      return stopUnfinished({ ...state, status: 'error', error: event.message }, event.message);
  }
}

/** Reviewers that were still waiting or running when the request ended can't finish. */
function stopUnfinished(state: ReviewState, message: string): ReviewState {
  return {
    ...state,
    reviewers: state.reviewers.map((r) => (r.status === 'waiting' || r.status === 'running' ? { ...r, status: 'error', error: message } : r)),
  };
}

const isFinal = (e: StreamEvent) => e.type === 'done' || e.type === 'error';
const starting = (initial: ReviewState): ReviewState => ({ ...initial, status: 'extracting' });
const fail = (state: ReviewState, message: string): ReviewState =>
  state.status === 'done' ? state : stopUnfinished({ ...state, status: 'error', error: message }, message);

export function useReviewStream() {
  const { state, start, cancel } = useNdjsonRequest<ReviewState, StreamEvent>({
    url: '/api/review',
    initial: initialReviewState,
    starting,
    reduce: reduceEvent,
    isFinal,
    fail,
  });

  const run = useCallback(
    (file: File) => {
      const body = new FormData();
      body.append('resume', file);
      return start(body);
    },
    [start],
  );

  return { state, start: run, cancel };
}
