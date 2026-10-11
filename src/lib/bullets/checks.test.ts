import { describe, expect, it } from 'vitest';
import { extractNumbers, numbersNotInSources, runCodeChecks, termsNotInSources, wordCount } from './checks';

describe('extractNumbers', () => {
  it('normalizes digits, separators, percentages, and number words', () => {
    expect([...extractNumbers('Cut load time 40% for 1,200 users in two weeks; doubled sign-ups')].sort()).toEqual(
      ['1200', '2', '40'].sort(),
    );
  });

  it('ignores "one", which is rarely a claim', () => {
    expect(extractNumbers('one of the first teams').size).toBe(0);
  });
});

describe('numbersNotInSources', () => {
  it('flags an invented percentage', () => {
    expect(numbersNotInSources('Raised conversion 25%', 'Raised conversion on checkout')).toEqual(['25']);
  });

  it('accepts a number written differently from the source', () => {
    expect(numbersNotInSources('Resolved it within 2 weeks', 'resolved within two weeks')).toEqual([]);
  });

  it('accepts version numbers that the source states', () => {
    expect(numbersNotInSources('Built it in React 18', 'using React 18 and TypeScript')).toEqual([]);
  });
});

describe('termsNotInSources', () => {
  const sources = 'Implemented aria labels and aria-describedby; tested with VOiceOver in Chrome and NVDA; made titles <h2>.';

  it('flags a standard the sources never mention', () => {
    expect(termsNotInSources('Met WCAG criteria using aria-describedby', sources)).toEqual(['WCAG']);
  });

  it('accepts terms the sources mention, in any case', () => {
    expect(termsNotInSources('Tested with VoiceOver and NVDA; added ARIA labels and h2 titles', sources)).toEqual([]);
  });

  it('flags a new capitalized product name but not the opening verb', () => {
    expect(termsNotInSources('Verified fixes with JAWS in Chrome', sources)).toEqual(['JAWS']);
  });
});

describe('runCodeChecks', () => {
  it('passes a bullet that only rephrases the sources', () => {
    const checks = runCodeChecks('Tested search with VoiceOver and NVDA', 'tested with VoiceOver and NVDA', 25);
    expect(checks.every((c) => c.passed)).toBe(true);
  });

  it('gives specific feedback for each failure', () => {
    const checks = runCodeChecks('I improved conversion by 30% with Redux', 'improved conversion', 4);
    const failed = Object.fromEntries(checks.filter((c) => !c.passed).map((c) => [c.id, c.feedback]));
    expect(Object.keys(failed).sort()).toEqual(['first_person', 'length', 'numbers', 'terms']);
    expect(failed.numbers).toContain('30');
    expect(failed.terms).toContain('Redux');
  });

  it('counts words', () => {
    expect(wordCount('  Built a   design system ')).toBe(4);
  });
});
