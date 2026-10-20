import { z } from 'zod';

/** What the browser sends to /api/bullets. Validated on the server; notes are never stored. */
export const BulletRequestSchema = z
  .object({
    role: z.string().trim().max(200).optional(),
    bullet: z.string().trim().max(600).default(''),
    target: z.string().trim().max(1000).optional(),
    noteGroups: z.array(z.array(z.string().trim().min(1).max(500)).min(1)).max(8).default([]),
    avoid: z.array(z.string().trim().min(2).max(40)).max(30).default([]),
    prefer: z.record(z.string(), z.string().trim().max(80)).default({}),
    noCodeSyntax: z.boolean().default(false),
    maxWords: z.number().int().min(10).max(60).default(30),
  })
  .refine((r) => r.bullet !== '' || r.noteGroups.length > 0, { error: 'Add a bullet to improve, or at least one note.' })
  .refine((r) => r.noteGroups.flat().length <= 15, { error: 'Keep it to 15 notes or fewer.' });

/** Notes as typed: one fact per line, a blank line between unrelated pieces of work. */
export function parseNoteGroups(text: string): string[][] {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((group) => group.length > 0);
}

export type BulletRequest = z.input<typeof BulletRequestSchema>;

/** The person's writing style, kept in their browser. Raw text so the fields edit naturally. */
export interface WritingStyle {
  /** Comma-separated words they don't use. */
  avoidText: string;
  /** One replacement per line: "verticals -> internal partners". */
  preferText: string;
  noCodeSyntax: boolean;
}

export const DEFAULT_STYLE: WritingStyle = { avoidText: '', preferText: '', noCodeSyntax: false };

/** For reading saved settings back: browser storage can hold anything. */
export function isWritingStyle(value: unknown): value is WritingStyle {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.avoidText === 'string' && typeof v.preferText === 'string' && typeof v.noCodeSyntax === 'boolean';
}

export function parseStyle(style: WritingStyle): { avoid: string[]; prefer: Record<string, string>; noCodeSyntax: boolean } {
  const avoid = style.avoidText
    .split(',')
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
  const prefer: Record<string, string> = {};
  for (const line of style.preferText.split('\n')) {
    const [word, instead] = line.split(/\s*(?:->|→)\s*/);
    if (word?.trim() && instead?.trim()) prefer[word.trim()] = instead.trim();
  }
  return { avoid, prefer, noCodeSyntax: style.noCodeSyntax };
}
