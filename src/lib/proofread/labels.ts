import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { loadResume } from '@/lib/eval/fixtures';
import type { ExtractedDocument } from '@/lib/pdf/extract';
import { isQuoteInText, normalizeForMatch } from '@/lib/review/grounding';

export const LABEL_KINDS = ['nonword', 'realword', 'tech-casing', 'trap', 'arguable'] as const;
export type LabelKind = (typeof LABEL_KINDS)[number];

/**
 * Labeled proofreading fixtures. Not named *.eval.json on purpose: those are
 * review fixtures, and `npm run eval` would run a full review on this file.
 *
 * trap = correct but uncommon, must not be flagged.
 * arguable = a style call; reported, never scored.
 */
export const LabelsFileSchema = z.object({
  description: z.string().min(1),
  /** Path to the resume (.txt or .pdf), relative to this file. */
  resume: z.string().min(1),
  items: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(LABEL_KINDS),
      /** The word or phrase exactly as it appears in the resume. */
      text: z.string().min(1),
      /** A short quote that appears once in the resume and contains `text`. */
      context: z.string().min(1),
      fix: z.string().optional(),
    }),
  ),
});

export type LabelItem = z.infer<typeof LabelsFileSchema>['items'][number];

export interface LabeledResume {
  name: string;
  description: string;
  items: LabelItem[];
  doc: ExtractedDocument;
}

export async function loadLabeledResume(labelsPath: string): Promise<LabeledResume> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(labelsPath, 'utf8'));
  } catch (err) {
    throw new Error(`${labelsPath} could not be read as JSON: ${err instanceof Error ? err.message : err}`);
  }
  const parsed = LabelsFileSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${labelsPath} has problems:\n${z.prettifyError(parsed.error)}`);

  const doc = await loadResume(path.resolve(path.dirname(labelsPath), parsed.data.resume));
  const problems = validateLabels(parsed.data.items, doc);
  if (problems.length > 0) throw new Error(`${labelsPath} has problems:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  return { name: path.basename(labelsPath).replace(/\.labels\.json$/, ''), description: parsed.data.description, items: parsed.data.items, doc };
}

/**
 * Problems that would make a labels file's scores meaningless. Run before any
 * model call, for public and private files alike.
 */
export function validateLabels(items: readonly LabelItem[], doc: ExtractedDocument): string[] {
  const problems: string[] = [];
  const source = normalizeForMatch(doc.text);
  const seen = new Set<string>();

  for (const item of items) {
    if (seen.has(item.id)) problems.push(`"${item.id}" is used twice.`);
    seen.add(item.id);

    const context = normalizeForMatch(item.context);
    if (!isQuoteInText(item.context, doc.text)) {
      problems.push(`"${item.id}": the context isn't in the resume text. Copy it from "What a parser sees" in the app.`);
      continue;
    }
    if (source.split(context).length - 1 > 1) problems.push(`"${item.id}": the context appears more than once. Make it longer.`);
    if (!context.includes(normalizeForMatch(item.text))) problems.push(`"${item.id}": the text isn't inside its context.`);
  }
  return problems;
}
