import { z } from 'zod';

/** What the browser sends to /api/bullets. Validated on the server; notes are never stored. */
export const BulletRequestSchema = z
  .object({
    role: z.string().trim().max(200).optional(),
    bullet: z.string().trim().max(600).default(''),
    target: z.string().trim().max(1000).optional(),
    notes: z.array(z.string().trim().min(1).max(500)).max(15).default([]),
    avoid: z.array(z.string().trim().min(2).max(40)).max(30).default([]),
    prefer: z.record(z.string(), z.string().trim().max(80)).default({}),
    noCodeSyntax: z.boolean().default(false),
    maxWords: z.number().int().min(10).max(60).default(30),
  })
  .refine((r) => r.bullet !== '' || r.notes.length > 0, { error: 'Add a bullet to improve, or at least one note.' });

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
