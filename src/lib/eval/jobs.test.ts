import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MatchReport, Requirement } from '@/lib/jobs/schema';
import { checkExtraction, checkMatches, findJobFixtures, JobFixtureSchema, validateJobFixture, type JobFixture } from './jobs';

const POSTING = `Requirements
3+ years of React experience.
Experience with design systems.
Nice to have
GraphQL experience.
Benefits: Unlimited PTO.`;

function fixture(overrides: Partial<Record<string, unknown>> = {}): JobFixture {
  const parsed = JobFixtureSchema.parse({
    description: 'test',
    posting: 'p.txt',
    resume: 'r.txt',
    extraction: { mustNotExtract: ['Unlimited PTO'] },
    requirements: [
      { text: '3+ years of React experience.', tier: 'required', accept: ['met'] },
      { text: 'Experience with design systems.', tier: 'required', accept: ['met', 'partial'] },
      { text: 'GraphQL experience.', tier: 'bonus', accept: ['missing'] },
    ],
    ...overrides,
  });
  return { ...parsed, name: 'test', postingPath: 'p.txt', resumePath: 'r.txt' };
}

const req = (id: number, text: string, tier: Requirement['tier'], foundInPosting = true): Requirement => ({ id, text, tier, foundInPosting });

describe('validateJobFixture', () => {
  it('accepts a fixture whose requirements are all in the posting', () => {
    expect(validateJobFixture(fixture(), POSTING)).toEqual([]);
  });

  it('flags requirements that are not word for word in the posting', () => {
    const f = fixture({ requirements: [{ text: 'Five years of React.', tier: 'required', accept: ['met'] }] });
    expect(validateJobFixture(f, POSTING)[0]).toContain("isn't word for word");
  });

  it('flags a forbidden phrase that appears in an expected requirement', () => {
    const f = fixture({ extraction: { mustNotExtract: ['design systems'] } });
    expect(validateJobFixture(f, POSTING)[0]).toContain('could never pass');
  });
});

describe('checkExtraction', () => {
  it('measures recall, tiers, extras, forbidden text, and rewording', () => {
    const result = checkExtraction(
      [
        req(1, '3+ years of React experience.', 'required'),
        req(2, 'GraphQL experience.', 'required'), // wrong tier
        req(3, 'Benefits: Unlimited PTO.', 'bonus'),
        req(4, 'Knows React well', 'required', false),
      ],
      fixture(),
    );
    expect(result).toMatchObject({ expected: 3, found: 2, tierCorrect: 1, reworded: 1 });
    expect(result.extras).toEqual(['Benefits: Unlimited PTO.', 'Knows React well']);
    expect(result.forbidden).toEqual(['Benefits: Unlimited PTO.']);
    expect(result.countsByTier).toEqual({ required: 3, preferred: 0, bonus: 1 });
  });
});

describe('checkMatches', () => {
  const evidence = 'Built a shared component library in React used by nine product teams';
  const report: MatchReport = {
    matches: [
      { ...req(1, '', 'required'), status: 'met', evidence, gap: '', evidenceFound: true },
      { ...req(2, '', 'required'), status: 'missing', evidence: '', gap: '', evidenceFound: true },
    ],
    unanswered: [3],
    counts: { required: { met: 1, partial: 0, missing: 1 }, preferred: { met: 0, partial: 0, missing: 0 }, bonus: { met: 0, partial: 0, missing: 0 } },
  };
  const result = checkMatches(report, fixture());

  it('accepts any listed status and fails the rest, including unanswered', () => {
    expect(result.requirements.map((r) => [r.got, r.passed])).toEqual([
      ['met', true],
      ['missing', false],
      ['unanswered', false],
    ]);
  });

  it('counts empty gaps on partial or missing answers', () => {
    expect(result.emptyGaps).toBe(1);
  });

  it('treats a passage quoted in full and in part as the same passage', () => {
    const reused = checkMatches(
      {
        ...report,
        matches: [
          { ...req(1, '', 'required'), status: 'met', evidence, gap: '', evidenceFound: true },
          { ...req(2, '', 'required'), status: 'met', evidence: evidence.slice(0, 45), gap: '', evidenceFound: true },
        ],
      },
      fixture(),
    );
    expect(reused.maxEvidenceReuse).toBe(2);
  });
});

// Guards the shipped job fixtures themselves, like fixtures.test.ts does for review fixtures.
const shipped = await findJobFixtures([{ dir: path.join(process.cwd(), 'fixtures', 'jobs'), prefix: '' }]);

describe('shipped job fixtures', () => {
  it('exist', () => {
    expect(shipped.length).toBeGreaterThan(0);
  });

  for (const f of shipped) {
    it(`${f.name} passes validation`, async () => {
      expect(validateJobFixture(f, await readFile(f.postingPath, 'utf8'))).toEqual([]);
    });
  }
});
