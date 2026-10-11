import { beforeAll, describe, expect, it } from 'vitest';
import { improveBullet, sourcesText } from './loop';

beforeAll(() => {
  process.env.LLM_PROVIDER = 'mock';
  process.env.MOCK_DELAY_MS = '0';
});

describe('sourcesText', () => {
  it('includes the bullet and notes but never the target requirement', () => {
    const text = sourcesText({ bullet: 'Built search.', notes: ['Tested with NVDA.'], target: '5+ years of WCAG work', maxWords: 25 });
    expect(text).toContain('Tested with NVDA.');
    expect(text).not.toContain('WCAG');
  });
});

describe('improveBullet with the mock provider', () => {
  it('runs the checks and the judge, and stops once everything passes', async () => {
    const rounds: number[] = [];
    const result = await improveBullet(
      { bullet: 'Built a shared component library in React used by nine product teams', notes: [], maxWords: 25 },
      { log: false, onRound: (_round, i) => rounds.push(i) },
    );
    expect(result.status).toBe('passed');
    expect(rounds).toEqual([0]);
    if (result.status === 'error') return;
    expect(result.rounds[0]?.judged).toBe(true);
    expect(result.calls.map((c) => c.task)).toEqual(['bullet:draft', 'bullet:judge']);
  });
});
