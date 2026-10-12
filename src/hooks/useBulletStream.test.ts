import { describe, expect, it } from 'vitest';
import { initialBulletState, reduceBulletEvent, type BulletState } from './useBulletStream';

function play(...events: Parameters<typeof reduceBulletEvent>[1][]): BulletState {
  return events.reduce(reduceBulletEvent, { ...initialBulletState, phase: 'drafting' });
}

const drafted = {
  type: 'drafted' as const,
  candidates: [
    { angle: 'what was built', bullet: 'Built A' },
    { angle: 'how it was verified', bullet: 'Tested B' },
  ],
  questions: ['What changed for users?'],
};

describe('reduceBulletEvent', () => {
  it('shows the first drafts as being checked', () => {
    const state = play(drafted);
    expect(state.phase).toBe('checking');
    expect(state.candidates.map((c) => c.status)).toEqual(['checking', 'checking']);
    expect(state.questions).toEqual(['What changed for users?']);
  });

  it('marks a candidate as revising, with the reason, when a round fails', () => {
    const state = play(drafted, { type: 'round', index: 1, roundIndex: 0, draft: 'Tested B 40%', passed: false, failing: ['numbers'] });
    expect(state.candidates[1]).toMatchObject({ status: 'revising', failing: ['numbers'], draft: 'Tested B 40%' });
    expect(state.candidates[0]?.status).toBe('checking');
  });

  it('settles each candidate on its final bullet, then finishes', () => {
    const state = play(
      drafted,
      { type: 'candidate_done', index: 0, status: 'passed', bullet: 'Built A' },
      { type: 'candidate_done', index: 1, status: 'failed', bullet: 'Tested B 40%' },
      { type: 'done' },
    );
    expect(state.phase).toBe('done');
    expect(state.candidates.map((c) => c.status)).toEqual(['passed', 'failed']);
  });
});
