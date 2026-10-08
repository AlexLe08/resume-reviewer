import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { extractPdfText, normalizeWhitespace, type ExtractedDocument } from '@/lib/pdf/extract';
import { normalizeForMatch } from '@/lib/review/grounding';

/**
 * Search terms are matched as whole words, case-insensitively.
 * End a term with * to match any word starting with it: "quantif*" matches
 * "quantify" and "quantified".
 */
const Terms = z.array(z.string().min(2)).min(1);
const Verdict = z.enum(['yes', 'maybe', 'no']);

export const ExpectationsSchema = z.object({
  /** The verdicts a reasonable reviewer could give this resume. */
  verdictIn: z.array(Verdict).min(1).optional(),
  /** Problems any good review must raise. Searched in issues unless in: "anywhere". */
  mustMention: z
    .array(
      z.object({
        id: z.string().min(1),
        anyOf: Terms,
        in: z.enum(['issues', 'anywhere']).default('issues'),
        /** If set, only issues at this severity or higher count. */
        minSeverity: z.enum(['low', 'medium', 'high']).optional(),
      }),
    )
    .default([]),
  /** Things a review must never bring up, e.g. protected characteristics. Quotes are not searched. */
  mustNotMention: z.array(z.object({ id: z.string().min(1), anyOf: Terms })).default([]),
  /** Passages that should not be used as evidence for a strength, e.g. the candidate's self-written summary. */
  strengthEvidenceNotIn: z.array(z.object({ id: z.string().min(1), text: z.string().min(10) })).default([]),
});

export type Expectations = z.infer<typeof ExpectationsSchema>;

export const FixtureFileSchema = z.object({
  description: z.string().min(1),
  /** Path to the resume (.txt or .pdf), relative to this fixture file. */
  resume: z.string().min(1),
  expect: ExpectationsSchema,
});

export interface Fixture {
  name: string;
  description: string;
  resumePath: string;
  expect: Expectations;
}

const SUFFIX = '.eval.json';

/** Finds every *.eval.json file in the given folders. Missing folders are skipped. */
export async function findFixtures(sources: { dir: string; prefix: string }[]): Promise<Fixture[]> {
  const fixtures: Fixture[] = [];

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
      const parsed = FixtureFileSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(`${fullPath} has problems:\n${z.prettifyError(parsed.error)}`);
      }
      fixtures.push({
        name: prefix + file.slice(0, -SUFFIX.length),
        description: parsed.data.description,
        resumePath: path.resolve(dir, parsed.data.resume),
        expect: parsed.data.expect,
      });
    }
  }

  return fixtures;
}

/** PDFs go through the same extraction as uploads. Text files skip it, which keeps synthetic fixtures easy to write. */
export async function loadResume(resumePath: string): Promise<ExtractedDocument> {
  if (resumePath.toLowerCase().endsWith('.pdf')) {
    return extractPdfText(new Uint8Array(await readFile(resumePath)));
  }
  return { text: normalizeWhitespace(await readFile(resumePath, 'utf8')), pageCount: 1 };
}

/**
 * Problems that would make a fixture's checks meaningless. Run before any
 * model call, for public and private fixtures alike.
 */
export function validateFixture(fixture: Fixture, doc: ExtractedDocument): string[] {
  const text = normalizeForMatch(doc.text);
  return fixture.expect.strengthEvidenceNotIn
    .filter((rule) => !text.includes(normalizeForMatch(rule.text)))
    .map(
      (rule) =>
        `${fixture.name}: the "${rule.id}" passage isn't in the resume text. ` +
        `Copy it from "What a parser sees" in the app, not from the original document.`,
    );
}
