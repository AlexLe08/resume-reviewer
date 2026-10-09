import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { MATCH_STATUSES, TIERS, type MatchReport, type MatchStatus, type Requirement, type Tier } from '@/lib/jobs/schema';
import { isQuoteInText, normalizeForMatch } from '@/lib/review/grounding';
import { containsTerm } from './assertions';

/**
 * A job fixture: a posting, a resume, and the posting's requirements with the
 * statuses a careful reader of the resume could give each one.
 *
 * Expected statuses reflect what the RESUME shows, not what the candidate
 * knows. Experience the resume doesn't mention belongs in the resume, not here.
 */
export const JobFixtureSchema = z.object({
  description: z.string().min(1),
  /** Paths relative to this fixture file. */
  posting: z.string().min(1),
  resume: z.string().min(1),
  extraction: z
    .object({
      /** Phrases that must never appear in an extracted requirement: benefits, EEO text, responsibilities. */
      mustNotExtract: z.array(z.string().min(2)).default([]),
    })
    .default({ mustNotExtract: [] }),
  /** In posting order. Also the frozen input for matching evals. */
  requirements: z
    .array(
      z.object({
        text: z.string().min(3),
        tier: z.enum(TIERS),
        accept: z.array(z.enum(MATCH_STATUSES)).min(1),
      }),
    )
    .min(1),
});

export type JobFixtureFile = z.infer<typeof JobFixtureSchema>;

export interface JobFixture extends JobFixtureFile {
  name: string;
  postingPath: string;
  resumePath: string;
}

const SUFFIX = '.job.json';

export async function findJobFixtures(sources: { dir: string; prefix: string }[]): Promise<JobFixture[]> {
  const fixtures: JobFixture[] = [];
  for (const { dir, prefix } of sources) {
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of files.filter((f) => f.endsWith(SUFFIX)).sort()) {
      const fullPath = path.join(dir, file);
      let json: unknown;
      try {
        json = JSON.parse(await readFile(fullPath, 'utf8'));
      } catch (err) {
        throw new Error(`${fullPath} is not valid JSON: ${err instanceof Error ? err.message : err}`);
      }
      const parsed = JobFixtureSchema.safeParse(json);
      if (!parsed.success) throw new Error(`${fullPath} has problems:\n${z.prettifyError(parsed.error)}`);
      fixtures.push({
        ...parsed.data,
        name: prefix + file.slice(0, -SUFFIX.length),
        postingPath: path.resolve(dir, parsed.data.posting),
        resumePath: path.resolve(dir, parsed.data.resume),
      });
    }
  }
  return fixtures;
}

/** Problems that would make a fixture's checks meaningless. Run before any model call. */
export function validateJobFixture(fixture: JobFixture, posting: string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of fixture.requirements) {
    if (!isQuoteInText(r.text, posting)) {
      problems.push(`${fixture.name}: requirement isn't word for word in the posting: "${r.text.slice(0, 60)}…"`);
    }
    const key = normalizeForMatch(r.text);
    if (seen.has(key)) problems.push(`${fixture.name}: duplicate requirement "${r.text.slice(0, 60)}…"`);
    seen.add(key);
  }
  for (const phrase of fixture.extraction.mustNotExtract) {
    if (fixture.requirements.some((r) => containsTerm(r.text, phrase))) {
      problems.push(`${fixture.name}: mustNotExtract "${phrase}" appears in an expected requirement, so the check could never pass`);
    }
  }
  return problems;
}

/** The fixture's requirement list in the shape the matcher takes. */
export function frozenRequirements(fixture: JobFixture): Requirement[] {
  return fixture.requirements.map((r, i) => ({ id: i + 1, text: r.text, tier: r.tier, foundInPosting: true }));
}

// ---------------------------------------------------------------- extraction

export interface ExtractionCheck {
  expected: number;
  /** Expected requirements that were extracted (normalized text match). */
  found: number;
  /** Of those found, how many got the expected tier. */
  tierCorrect: number;
  /** Extracted requirements that aren't in the expected list. */
  extras: string[];
  /** Extracted requirements containing a mustNotExtract phrase. */
  forbidden: string[];
  /** Extracted requirements that aren't word for word from the posting. */
  reworded: number;
  countsByTier: Record<Tier, number>;
}

export function checkExtraction(extracted: Requirement[], fixture: JobFixture): ExtractionCheck {
  const byText = new Map(extracted.map((r) => [normalizeForMatch(r.text), r]));
  const expectedKeys = new Set(fixture.requirements.map((r) => normalizeForMatch(r.text)));

  let found = 0;
  let tierCorrect = 0;
  for (const expected of fixture.requirements) {
    const got = byText.get(normalizeForMatch(expected.text));
    if (!got) continue;
    found++;
    if (got.tier === expected.tier) tierCorrect++;
  }

  const countsByTier = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  for (const r of extracted) countsByTier[r.tier]++;

  return {
    expected: fixture.requirements.length,
    found,
    tierCorrect,
    extras: extracted.filter((r) => !expectedKeys.has(normalizeForMatch(r.text))).map((r) => r.text),
    forbidden: extracted
      .filter((r) => fixture.extraction.mustNotExtract.some((phrase) => containsTerm(r.text, phrase)))
      .map((r) => r.text),
    reworded: extracted.filter((r) => !r.foundInPosting).length,
    countsByTier,
  };
}

// ------------------------------------------------------------------ matching

export interface RequirementCheck {
  id: number;
  tier: Tier;
  text: string;
  accept: MatchStatus[];
  got: MatchStatus | 'unanswered';
  passed: boolean;
}

export interface MatchCheck {
  requirements: RequirementCheck[];
  quotes: number;
  quotesFound: number;
  /** The most requirements any single evidence passage was cited for. High means one bullet is doing all the work. */
  maxEvidenceReuse: number;
  /** Partial or missing answers with no explanation of the gap. */
  emptyGaps: number;
}

export function checkMatches(report: MatchReport, fixture: JobFixture): MatchCheck {
  const byId = new Map(report.matches.map((m) => [m.id, m]));
  const requirements = fixture.requirements.map((expected, i): RequirementCheck => {
    const got = byId.get(i + 1);
    const status = got?.status ?? 'unanswered';
    return {
      id: i + 1,
      tier: expected.tier,
      text: expected.text,
      accept: expected.accept,
      got: status,
      passed: status !== 'unanswered' && expected.accept.includes(status),
    };
  });

  const quoted = report.matches.filter((m) => m.evidence !== '');
  const reuse = new Map<string, number>();
  for (const m of quoted) {
    // Keyed on the opening words, so a passage quoted in full and in part counts as the same passage.
    const key = normalizeForMatch(m.evidence).slice(0, 40);
    reuse.set(key, (reuse.get(key) ?? 0) + 1);
  }

  return {
    requirements,
    quotes: quoted.length,
    quotesFound: quoted.filter((m) => m.evidenceFound).length,
    maxEvidenceReuse: Math.max(0, ...reuse.values()),
    emptyGaps: report.matches.filter((m) => m.status !== 'met' && m.gap === '').length,
  };
}
