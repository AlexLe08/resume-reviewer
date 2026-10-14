export interface SpellIssue {
  word: string;
  offset: number;
  suggestions: string[];
  /** A short stretch of the text around the word, shaped like a model's quote. */
  context: string;
}

const CONTEXT_CHARS = 25;

/**
 * Code-side proofreading: cspell with its software-terms and companies
 * dictionaries and no project wordlist. noConfigSearch stops it reading a
 * cspell.json from the repo. It checks words one at a time, so it cannot see
 * real-word errors ("form" for "from").
 */
export async function checkSpelling(text: string): Promise<SpellIssue[]> {
  // cspell-lib is ESM-only and this package compiles to CommonJS, so a static import fails under tsx.
  const { spellCheckDocument } = await import('cspell-lib');
  const result = await spellCheckDocument(
    { uri: 'resume.txt', text, languageId: 'plaintext', locale: 'en' },
    { generateSuggestions: true, noConfigSearch: true },
    { dictionaries: ['softwareTerms', 'companies'], caseSensitive: true },
  );
  return result.issues.map((issue) => ({
    word: issue.text,
    offset: issue.offset,
    suggestions: (issue.suggestions ?? []).slice(0, 3),
    context: text.slice(Math.max(0, issue.offset - CONTEXT_CHARS), issue.offset + issue.text.length + CONTEXT_CHARS),
  }));
}
