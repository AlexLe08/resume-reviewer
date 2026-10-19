import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findLabelFiles, type LabelItem } from './labels';
import { formatResultLine, summarizeFlags } from './report';

const labels: LabelItem[] = [
  { id: 'a', kind: 'nonword', text: 'bookign', context: 'the bookign flow', fix: 'booking' },
  { id: 't', kind: 'trap', text: 'Playwright', context: 'tested with Playwright' },
];

describe('summarizeFlags', () => {
  it('counts caught errors, flagged traps and unlabeled flags', () => {
    const r = summarizeFlags(
      'model',
      1,
      10,
      [
        { word: 'bookign', context: 'the bookign flow' },
        { word: 'Playwright', context: 'tested with Playwright' },
        { word: 'other', context: 'elsewhere' },
      ],
      labels,
    );
    expect(r.kinds.nonword).toEqual({ caught: 1, total: 1 });
    expect(r.trapsFlagged).toBe(1);
    expect(r.unlabeled).toBe(1);
  });

  it('prints counts and no resume text', () => {
    const line = formatResultLine(summarizeFlags('model', 1, 5, [{ word: 'bookign', context: 'the bookign flow' }], labels));
    expect(line).toContain('nonword   1/1');
    expect(line).not.toContain('bookign');
  });
});

describe('findLabelFiles', () => {
  it('finds the public labels files and not review fixtures', async () => {
    const names = (await findLabelFiles(path.join(process.cwd(), 'fixtures'))).map((f) => path.basename(f));
    expect(names).toContain('typos.labels.json');
    expect(names.every((n) => n.endsWith('.labels.json'))).toBe(true);
  });
});
