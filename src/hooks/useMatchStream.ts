'use client';

import { useCallback } from 'react';
import type { MatchReport, Requirement, RequirementMatch } from '@/lib/jobs/schema';
import type { CallRecord } from '@/lib/llm/usage';
import type { MatchStreamEvent } from '@/lib/stream/match-events';
import { useNdjsonRequest } from './useNdjsonRequest';

export type MatchStatusPhase = 'idle' | 'reading' | 'extracting' | 'matching' | 'done' | 'error';

export interface MatchState {
  phase: MatchStatusPhase;
  requirements: Requirement[];
  /** Results so far, by requirement id. */
  matches: Record<number, RequirementMatch>;
  report?: MatchReport;
  calls: CallRecord[];
  error?: string;
}

export const initialMatchState: MatchState = { phase: 'idle', requirements: [], matches: {}, calls: [] };

/** Pure: (state, event) → new state. Streamed items are provisional; *_done events replace them. */
export function reduceMatchEvent(state: MatchState, event: MatchStreamEvent): MatchState {
  switch (event.type) {
    case 'resume_read':
      return { ...state, phase: 'extracting' };
    case 'requirement':
      return {
        ...state,
        requirements: [...state.requirements.filter((r) => r.id !== event.requirement.id), event.requirement],
      };
    case 'requirements_done':
      return { ...state, phase: 'matching', requirements: event.requirements, calls: [...state.calls, event.call] };
    case 'match':
      return { ...state, matches: { ...state.matches, [event.match.id]: event.match } };
    case 'match_done':
      return {
        ...state,
        phase: 'done',
        report: event.report,
        matches: Object.fromEntries(event.report.matches.map((m) => [m.id, m])),
        calls: [...state.calls, event.call],
      };
    case 'error':
      return { ...state, phase: 'error', error: event.message };
  }
}

const isFinal = (e: MatchStreamEvent) => e.type === 'match_done' || e.type === 'error';
const starting = (initial: MatchState): MatchState => ({ ...initial, phase: 'reading' });
const fail = (state: MatchState, message: string): MatchState =>
  state.phase === 'done' ? state : { ...state, phase: 'error', error: message };

export function useMatchStream() {
  const { state, start, cancel } = useNdjsonRequest<MatchState, MatchStreamEvent>({
    url: '/api/match',
    initial: initialMatchState,
    starting,
    reduce: reduceMatchEvent,
    isFinal,
    fail,
  });

  const run = useCallback(
    (file: File, posting: string) => {
      const body = new FormData();
      body.append('resume', file);
      body.append('posting', posting);
      return start(body);
    },
    [start],
  );

  return { state, run, cancel };
}
