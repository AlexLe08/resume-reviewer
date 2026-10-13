import { beforeAll, describe, expect, it } from 'vitest';
import { improveBullet, sourcesText } from './loop';
import { taskFromFixture } from './fixture';

beforeAll(() => {
  process.env.LLM_PROVIDER = 'mock';
  process.env.MOCK_DELAY_MS = '0';
});

describe('sourcesText', () => {
  it('includes the bullet and notes but never the target requirement', () => {
    const text = sourcesText({ bullet: 'Built search.', noteGroups: [['Tested with NVDA.']], target: '5+ years of WCAG work', maxWords: 25 });
    expect(text).toContain('Tested with NVDA.');
    expect(text).not.toContain('WCAG');
  });
});

describe('improveBullet with the mock provider', () => {
  it('reports the first drafts once and each candidate when it finishes', async () => {
    const drafted: string[] = [];
    const finished: [number, string][] = [];
    await improveBullet(
      { bullet: 'Built a shared component library in React used by nine product teams', noteGroups: [], maxWords: 25 },
      {
        log: false,
        onDrafted: (candidates) => drafted.push(...candidates.map((c) => c.angle)),
        onCandidateDone: (i, c) => finished.push([i, c.status]),
      },
    );
    expect(drafted).toEqual(['what was built', 'shorter']);
    expect(finished).toEqual([
      [0, 'passed'],
      [1, 'passed'],
    ]);
  });

  it('checks every candidate, judges the ones that pass the code checks, and keeps them', async () => {
    const seen: number[] = [];
    const result = await improveBullet(
      { bullet: 'Built a shared component library in React used by nine product teams', noteGroups: [], maxWords: 25 },
      { log: false, onRound: (i) => seen.push(i) },
    );
    expect(result.status).toBe('done');
    if (result.status !== 'done') return;
    expect(result.candidates.map((c) => c.status)).toEqual(['passed', 'passed']);
    expect(seen).toEqual([0, 1]);
    expect(result.calls.map((c) => c.task)).toEqual(['bullet:draft', 'bullet:judge', 'bullet:judge']);
  });

  it('revises a candidate that breaks a style rule, up to the round limit', async () => {
    const result = await improveBullet(
      { bullet: 'Built a seamless library for internal partners', noteGroups: [], maxWords: 25, avoid: ['seamless'] },
      { log: false, maxRounds: 2 },
    );
    if (result.status !== 'done') throw new Error('expected done');
    // The mock never fixes anything, so the candidate keeps failing and stops at the limit.
    const first = result.candidates[0]!;
    expect(first.status).toBe('failed');
    expect(first.rounds).toHaveLength(2);
    expect(first.rounds[0]?.checks.find((c) => c.id === 'style')?.passed).toBe(false);
  });
});

describe('taskFromFixture', () => {
  it('reads flat notes as one group and grouped notes as given', () => {
    expect(taskFromFixture({ bullet: '', notes: ['a', 'b'], maxWords: 20 }).noteGroups).toEqual([['a', 'b']]);
    expect(taskFromFixture({ bullet: '', noteGroups: [['a'], ['b']], maxWords: 20 }).noteGroups).toEqual([['a'], ['b']]);
    expect(taskFromFixture({ bullet: 'x', notes: [], maxWords: 20 }).noteGroups).toEqual([]);
  });
});
