import { describe, expect, it } from 'vitest';
import type { Requirement, RequirementMatch } from '@/lib/jobs/schema';
import type { CallRecord } from '@/lib/llm/usage';
import { initialMatchState, reduceMatchEvent, type MatchState } from './useMatchStream';

const req = (id: number): Requirement => ({ id, text: `Requirement ${id}`, tier: 'required', foundInPosting: true });
const match = (id: number, status: RequirementMatch['status']): RequirementMatch => ({
  ...req(id), status, evidence: '', gap: '', evidenceFound: true,
});
const call = { task: 't' } as CallRecord;

function play(...events: Parameters<typeof reduceMatchEvent>[1][]): MatchState {
  return events.reduce(reduceMatchEvent, initialMatchState);
}

describe('reduceMatchEvent', () => {
  it('adds requirements as they stream in, without duplicates', () => {
    const state = play(
      { type: 'resume_read', pageCount: 1 },
      { type: 'requirement', requirement: req(1) },
      { type: 'requirement', requirement: req(1) },
      { type: 'requirement', requirement: req(2) },
    );
    expect(state.phase).toBe('extracting');
    expect(state.requirements.map((r) => r.id)).toEqual([1, 2]);
  });

  it('replaces streamed requirements with the validated list, then moves on to matching', () => {
    const state = play(
      { type: 'requirement', requirement: req(1) },
      { type: 'requirements_done', requirements: [req(1), req(2)], call },
    );
    expect(state).toMatchObject({ phase: 'matching', calls: [call] });
    expect(state.requirements).toHaveLength(2);
  });

  it('shows results as they arrive, then takes the final report as the truth', () => {
    const streamed = play({ type: 'match', match: match(1, 'met') });
    expect(streamed.matches[1]?.status).toBe('met');

    const done = reduceMatchEvent(streamed, {
      type: 'match_done',
      report: {
        matches: [match(1, 'partial')],
        unanswered: [2],
        counts: {
          required: { met: 0, partial: 1, missing: 0 },
          preferred: { met: 0, partial: 0, missing: 0 },
          bonus: { met: 0, partial: 0, missing: 0 },
        },
      },
      call,
    });
    expect(done.phase).toBe('done');
    expect(done.matches[1]?.status).toBe('partial');
  });

  it('keeps everything shown so far when an error arrives', () => {
    const state = play(
      { type: 'requirement', requirement: req(1) },
      { type: 'error', stage: 'match', message: 'Rate limited', retryable: true },
    );
    expect(state).toMatchObject({ phase: 'error', error: 'Rate limited' });
    expect(state.requirements).toHaveLength(1);
  });
});
