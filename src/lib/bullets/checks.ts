/**
 * Deterministic checks on a drafted bullet. The rule they enforce: a rewrite
 * may rephrase what the sources say, never add to it. Sources are the original
 * bullet and the candidate's own notes. The target requirement is NOT a
 * source: a posting asking for "5+ years" is not evidence the candidate has it.
 */

export interface CheckResult {
  id: 'empty' | 'numbers' | 'terms' | 'length' | 'first_person' | 'claims';
  passed: boolean;
  /** Short, for people reading a log. */
  detail: string;
  /** Specific instruction for the next draft. Empty when passed. */
  feedback: string;
}

// "one" is left out on purpose: "one of the…" is everywhere and isn't a claim.
const NUMBER_WORDS: Record<string, string> = {
  two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', twenty: '20', thirty: '30', fifty: '50', hundred: '100', thousand: '1000',
  million: '1000000', twice: '2', double: '2', doubled: '2', triple: '3', tripled: '3', half: '0.5',
};

/** Every number in the text, normalized: "1,200" → "1200", "two" → "2", "40%" → "40". */
export function extractNumbers(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    found.add(match[0].replace(/,(?=\d{3}\b)/g, ''));
  }
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const digits = NUMBER_WORDS[word];
    if (digits) found.add(digits);
  }
  return found;
}

export function numbersNotInSources(draft: string, sources: string): string[] {
  const allowed = extractNumbers(sources);
  return [...extractNumbers(draft)].filter((n) => !allowed.has(n));
}

/**
 * Named things in the draft (tools, standards, products, acronyms) that the
 * sources never mention. A heuristic: it looks at capitalized and technical-
 * looking words, skipping the opening verb. It can't catch a new lowercase
 * common word; that's what the model judge is for.
 */
export function termsNotInSources(draft: string, sources: string): string[] {
  const haystack = sources.toLowerCase();
  const tokens = draft
    .split(/\s+/)
    .map((t) => t.replace(/^[^\w<]+|[^\w>+#]+$/g, ''))
    .filter(Boolean);

  const flagged = new Set<string>();
  tokens.forEach((token, i) => {
    const technical =
      /[A-Z].*[A-Z]/.test(token) || // NVDA, VoiceOver, WCAG
      /[a-z][.#+][a-z0-9]/i.test(token) || // Next.js, C#, C++
      /^aria-/i.test(token) || // aria-describedby
      /^<\/?\w+>$/.test(token) || // <h2>
      (/[a-z]\d|\d[a-z]/i.test(token) && !/^\d+(st|nd|rd|th|s)$/i.test(token)); // h2, ES6 (not "2nd", "90s")
    const capitalized = i > 0 && /^[A-Z][a-z]/.test(token);
    if (!technical && !capitalized) return;
    const plain = token.toLowerCase().replace(/^<|>$/g, '');
    if (!haystack.includes(plain)) flagged.add(token);
  });
  return [...flagged];
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function runCodeChecks(draft: string, sources: string, maxWords: number): CheckResult[] {
  const text = draft.trim();
  if (!text) {
    return [{ id: 'empty', passed: false, detail: 'empty draft', feedback: 'The bullet was empty. Write one bullet.' }];
  }

  const numbers = numbersNotInSources(text, sources);
  const terms = termsNotInSources(text, sources);
  const words = wordCount(text);
  const firstPerson = /\b(I|me|my|we|our)\b/.test(text) || /\b(me|my|we|our)\b/i.test(text);

  return [
    {
      id: 'numbers',
      passed: numbers.length === 0,
      detail: numbers.length ? `numbers not in sources: ${numbers.join(', ')}` : 'ok',
      feedback: numbers.length
        ? `These numbers are not in the sources: ${numbers.join(', ')}. Remove them. If a number would make the bullet stronger, ask the candidate for it in questions instead.`
        : '',
    },
    {
      id: 'terms',
      passed: terms.length === 0,
      detail: terms.length ? `terms not in sources: ${terms.join(', ')}` : 'ok',
      feedback: terms.length
        ? `These names or terms are not in the sources: ${terms.join(', ')}. Remove them; use only tools, standards, and names the sources mention.`
        : '',
    },
    {
      id: 'length',
      passed: words <= maxWords,
      detail: `${words}/${maxWords} words`,
      feedback: words > maxWords ? `The bullet is ${words} words. Cut it to ${maxWords} words or fewer.` : '',
    },
    {
      id: 'first_person',
      passed: !firstPerson,
      detail: firstPerson ? 'uses first person' : 'ok',
      feedback: firstPerson ? 'Remove first-person words (I, me, my, we, our). Start with the action verb.' : '',
    },
  ];
}
