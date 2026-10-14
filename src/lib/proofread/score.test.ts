import { describe, expect, it } from 'vitest';
import type { LabelItem } from './labels';
import { countByKind, scoreFlags } from './score';

const labels: LabelItem[] = [
  { id: 'n1', kind: 'nonword', text: 'bookign', context: 'the bookign flow' },
  { id: 'r1', kind: 'realword', text: 'to were', context: 'to were promoted' },
  { id: 't1', kind: 'trap', text: 'Akamai', context: 'the Akamai CDN' },
  { id: 'a1', kind: 'arguable', text: 'Hard working', context: 'Hard working and' },
];

describe('scoreFlags', () => {
  it('matches by word and place, and sorts the rest into traps, style calls and false alarms', () => {
    const scored = scoreFlags(
      [
        { word: 'bookign', context: 'rebuild of the bookign flow in React' },
        { word: 'to', context: 'engineers; to were promoted within' },
        { word: 'Akamai', context: 'moving to the Akamai CDN.' },
        { word: 'Hard working', context: 'Hard working and motivated' },
        { word: 'Raman', context: 'Priya Raman' },
      ],
      labels,
    );
    expect([...scored.caught].sort()).toEqual(['n1', 'r1']);
    expect(scored.trapFlags.map((t) => t.labelId)).toEqual(['t1']);
    expect(scored.arguable).toHaveLength(1);
    expect(scored.unlabeled.map((f) => f.word)).toEqual(['Raman']);
    const counts = countByKind(scored, labels);
    expect(counts.nonword).toEqual({ caught: 1, total: 1 });
    expect(counts.realword).toEqual({ caught: 1, total: 1 });
  });

  it("does not count the same word elsewhere in the resume", () => {
    const scored = scoreFlags([{ word: 'to', context: 'from 4.1 s to 2.3 s by splitting' }], labels);
    expect(scored.caught.size).toBe(0);
    expect(scored.unlabeled).toHaveLength(1);
  });
});
