import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERSONAS } from '@/lib/review/personas';
import { expectationsFor, findFixtures, validateFixture, loadResume } from './fixtures';

// Guards the fixtures themselves: a typo in an expectation would silently make
// a check meaningless, and a meaningless check that always passes is worse than none.
const fixtures = await findFixtures([{ dir: path.join(process.cwd(), 'fixtures'), prefix: '' }]);

describe('shipped fixtures', () => {
  it('exist', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      it('points at a readable resume', async () => {
        await expect(readFile(fixture.resumePath)).resolves.toBeDefined();
      });

      it('only names reviewers that exist', () => {
        for (const id of Object.keys(fixture.reviewers)) expect(Object.hasOwn(PERSONAS, id), id).toBe(true);
      });

      it('passes validation', async () => {
        const doc = await loadResume(fixture.resumePath);
        expect(validateFixture(fixture, doc)).toEqual([]);
      });
    });
  }

  it('scores the recruiter on expect and other reviewers only where listed', () => {
    const withHm = fixtures.find((f) => 'hiring-manager' in f.reviewers)!;
    expect(expectationsFor(withHm, 'recruiter')).toBe(withHm.expect);
    expect(expectationsFor(withHm, 'hiring-manager')).toBe(withHm.reviewers['hiring-manager']);
    expect(expectationsFor(withHm, 'proofreader')).toBeUndefined();
  });
});
