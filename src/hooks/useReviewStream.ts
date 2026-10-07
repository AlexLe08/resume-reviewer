'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CheckResult } from '@/lib/checks';
import type { CallRecord } from '@/lib/llm/usage';
import type { Review } from '@/lib/review/schema';
import type { StreamEvent } from '@/lib/stream/events';
import { readNdjson } from '@/lib/stream/ndjson';

export type ReviewStatus = 'idle' | 'extracting' | 'reviewing' | 'done' | 'error';

export interface ReviewState {
  status: ReviewStatus;
  extracted?: { text: string; pageCount: number; checks: CheckResult[] };
  persona?: { id: string; name: string };
  /** How much of the review has streamed in so far. Drives the progress text. */
  liveChars: number;
  review?: Review;
  call?: CallRecord;
  error?: string;
}

export const initialReviewState: ReviewState = { status: 'idle', liveChars: 0 };

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
      };
    case 'review_started':
      return { ...state, persona: { id: event.personaId, name: event.personaName } };
    case 'review_delta':
      return { ...state, liveChars: state.liveChars + event.text.length };
    case 'review_done':
      return { ...state, status: 'done', review: event.review, call: event.call };
    case 'error':
      return { ...state, status: 'error', error: event.message };
  }
}

export function useReviewStream() {
  const [state, setState] = useState<ReviewState>(initialReviewState);
  const abortRef = useRef<AbortController | null>(null);

  // Stop any in-flight request if the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(async (file: File) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ ...initialReviewState, status: 'extracting' });

    const body = new FormData();
    body.append('resume', file);

    try {
      const res = await fetch('/api/review', { method: 'POST', body, signal: controller.signal });
      if (!res.ok || !res.body) {
        setState((s) => ({ ...s, status: 'error', error: await readErrorMessage(res) }));
        return;
      }

      let finished = false;
      for await (const event of readNdjson<StreamEvent>(res.body)) {
        if (event.type === 'review_done' || event.type === 'error') finished = true;
        setState((s) => reduceEvent(s, event));
      }
      if (!finished) {
        setState((s) => ({ ...s, status: 'error', error: 'The review stopped before it finished. Try again.' }));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error(err);
      setState((s) => ({
        ...s,
        status: 'error',
        error: 'Lost the connection to the server. Check that it is running and try again.',
      }));
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => ({ ...s, status: s.extracted ? 'error' : 'idle', error: s.extracted ? 'Review canceled.' : undefined }));
  }, []);

  return { state, start, cancel };
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json();
    if (typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  } catch {
    // Fall through to the generic message.
  }
  return `The server returned an error (${res.status}). Try again.`;
}
