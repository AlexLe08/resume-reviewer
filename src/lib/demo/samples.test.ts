import { describe, expect, it } from 'vitest';
import { DEMO_SAMPLES, DEMO_TODAY, findSample, loadSample } from './samples';

describe('demo samples', () => {
  it('have unique ids and load from the public fixtures folder', async () => {
    expect(new Set(DEMO_SAMPLES.map((s) => s.id)).size).toBe(DEMO_SAMPLES.length);
    for (const sample of DEMO_SAMPLES) {
      expect((await loadSample(sample)).text.length).toBeGreaterThan(200);
    }
  });

  it('can be found by id, and an unknown id finds nothing', () => {
    expect(findSample('weak-duties')?.file).toBe('weak-duties.txt');
    expect(findSample('private/my-resume')).toBeUndefined();
  });

  it('refuses a file name that points outside fixtures/', async () => {
    await expect(loadSample({ id: 'x', title: 't', blurb: 'b', file: '../fixtures/private/x.txt' })).rejects.toThrow('plain file name');
  });

  it('use a fixed date that formats as the same calendar day anywhere', () => {
    expect(DEMO_TODAY.toISOString().slice(0, 10)).toBe('2026-10-20');
  });
});
