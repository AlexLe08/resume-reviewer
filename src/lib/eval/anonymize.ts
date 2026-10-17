import { z } from 'zod';

/**
 * The mapping file lives in fixtures/private/ (gitignored), because the names
 * in it are exactly what must not be committed.
 */
export const AnonymizeMapSchema = z.object({
  /** Real name → placeholder. Use one-word placeholders such as "CompanyA": see replaceNames. */
  replacements: z
    .record(z.string().min(3, 'Names under 3 characters would match inside ordinary words.'), z.string().min(1))
    .refine((r) => Object.keys(r).length > 0, 'Add at least one name.'),
  /** Tracked files outside fixtures/private/ to rewrite too, e.g. "HANDOFF.md". */
  alsoFiles: z.array(z.string()).default([]),
});

export type AnonymizeMap = z.infer<typeof AnonymizeMapSchema>;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replaces whole words, case-insensitively, longest name first. A match written
 * entirely in lowercase (a domain such as "name.com") gets the lowercase
 * placeholder, so "Name" → "CompanyA" and "name.com" → "companya.com". Possessives
 * work because "'s" isn't part of the word.
 */
export function replaceNames(text: string, replacements: Record<string, string>): { text: string; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  let result = text;
  const names = Object.keys(replacements).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const placeholder = replacements[name]!;
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`, 'gi');
    result = result.replace(pattern, (match) => {
      counts[name] = (counts[name] ?? 0) + 1;
      return match === match.toLowerCase() ? placeholder.toLowerCase() : placeholder;
    });
  }
  return { text: result, counts };
}

export function totalCount(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/** Problems with the mapping itself, before any file is touched. */
export function mapProblems(map: AnonymizeMap): string[] {
  const problems: string[] = [];
  const names = Object.keys(map.replacements);
  for (const [name, placeholder] of Object.entries(map.replacements)) {
    if (name.toLowerCase() === placeholder.toLowerCase()) problems.push('A placeholder is the same as its name.');
    if (names.some((other) => placeholder.toLowerCase().includes(other.toLowerCase()))) {
      problems.push('A placeholder contains one of the names, so rerunning would change it again.');
    }
    if (/["\\\n]/.test(placeholder)) problems.push('Placeholders can\'t contain quotes, backslashes or line breaks (they would break JSON files).');
  }
  return [...new Set(problems)];
}
