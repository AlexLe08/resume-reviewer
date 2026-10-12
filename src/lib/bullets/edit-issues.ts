import { avoidedWordsUsed, codeSyntaxUsed, numbersNotInSources, termsNotInSources, wordCount } from './checks';

export interface EditContext {
  bullet: string;
  notes: string[];
  maxWords: number;
  avoid: string[];
  noCodeSyntax: boolean;
}

/**
 * The same code checks the loop runs, applied to the person's own edit and
 * worded for them. Warnings, not blocks: it's their resume. But if an edit adds
 * a number their notes don't have, they should know before they paste it.
 */
export function editIssues(text: string, ctx: EditContext): string[] {
  const sources = [ctx.bullet, ...ctx.notes].filter(Boolean).join('\n');
  const issues: string[] = [];
  const numbers = numbersNotInSources(text, sources);
  if (numbers.length) issues.push(`Adds ${numbers.join(', ')}, which isn't in your notes. If it's true, add it to your notes.`);
  const terms = termsNotInSources(text, sources);
  if (terms.length) issues.push(`Names ${terms.join(', ')}, which your notes don't mention.`);
  const words = wordCount(text);
  if (words > ctx.maxWords) issues.push(`${words} words; the limit is ${ctx.maxWords}.`);
  const avoided = avoidedWordsUsed(text, ctx.avoid);
  if (avoided.length) issues.push(`Uses words you avoid: ${avoided.join(', ')}.`);
  const code = ctx.noCodeSyntax ? codeSyntaxUsed(text) : [];
  if (code.length) issues.push(`Includes code syntax: ${code.join(', ')}.`);
  if (/\b(I|me|my|we|our)\b/.test(text)) issues.push('Uses first person.');
  return issues;
}
