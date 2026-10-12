'use client';

import { useCallback } from 'react';
import type { CheckResult } from '@/lib/bullets/checks';
import type { BulletRequest } from '@/lib/bullets/request';
import type { BulletStreamEvent } from '@/lib/stream/bullet-events';
import { useNdjsonRequest } from './useNdjsonRequest';

export interface CandidateView {
  angle: string;
  /** The latest draft: the first one, then each revision, then the final bullet. */
  draft: string;
  status: 'checking' | 'revising' | 'passed' | 'failed';
  /** Which checks the latest draft failed, so the screen can say why it's being revised. */
  failing: CheckResult['id'][];
}

export interface BulletState {
  phase: 'idle' | 'drafting' | 'checking' | 'done' | 'error';
  candidates: CandidateView[];
  questions: string[];
  error?: string;
}

export const initialBulletState: BulletState = { phase: 'idle', candidates: [], questions: [] };

/** Pure: (state, event) → new state. */
export function reduceBulletEvent(state: BulletState, event: BulletStreamEvent): BulletState {
  const update = (index: number, change: Partial<CandidateView>) =>
    state.candidates.map((c, i) => (i === index ? { ...c, ...change } : c));

  switch (event.type) {
    case 'drafted':
      return {
        ...state,
        phase: 'checking',
        questions: event.questions,
        candidates: event.candidates.map((c) => ({ angle: c.angle, draft: c.bullet, status: 'checking', failing: [] })),
      };
    case 'round':
      return {
        ...state,
        candidates: update(event.index, {
          draft: event.draft,
          failing: event.failing,
          ...(event.passed ? {} : { status: 'revising' as const }),
        }),
      };
    case 'candidate_done':
      return { ...state, candidates: update(event.index, { status: event.status, draft: event.bullet }) };
    case 'done':
      return { ...state, phase: 'done' };
    case 'error':
      return { ...state, phase: 'error', error: event.message };
  }
}

const isFinal = (e: BulletStreamEvent) => e.type === 'done' || e.type === 'error';
const starting = (initial: BulletState): BulletState => ({ ...initial, phase: 'drafting' });
const fail = (state: BulletState, message: string): BulletState =>
  state.phase === 'done' ? state : { ...state, phase: 'error', error: message };

export function useBulletStream() {
  const { state, start, cancel, reset } = useNdjsonRequest<BulletState, BulletStreamEvent>({
    url: '/api/bullets',
    initial: initialBulletState,
    starting,
    reduce: reduceBulletEvent,
    isFinal,
    fail,
  });

  const run = useCallback(
    (task: BulletRequest) => {
      const body = new FormData();
      body.append('task', JSON.stringify(task));
      return start(body);
    },
    [start],
  );

  return { state, run, cancel, reset };
}
