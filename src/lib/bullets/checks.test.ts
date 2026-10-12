import { describe, expect, it } from 'vitest';
import {
  avoidedWordsUsed,
  claimCoveredBySources,
  coverage,
  extractNumbers,
  numbersNotInSources,
  runCodeChecks,
  targetItems,
  termsNotInSources,
  wordCount,
} from './checks';

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

const TARGET =
  'Deep understanding of web accessibility, including WCAG, semantic HTML, ARIA, keyboard navigation, focus management, screen readers, and accessibility testing.';
const NOTES = [
  'Implemented the ARIA attributes expected on a combobox input and its suggestion listbox, such as aria-describedby.',
  'Made the section titles inside the suggestion listbox <h2> headings.',
  'Tested primarily with VoiceOver in Chrome, Firefox, and Safari.',
  'Worked with QA and an accessibility specialist to test with NVDA on Windows, and on mobile.',
  'Built keyboard navigation: correct tab order through the search elements, and arrow keys inside the suggestion list.',
  'Managed focus, such as returning focus to the search input after the clear-text button is pressed.',
].join('\n');

describe('targetItems', () => {
  it('splits the listed parts of a requirement', () => {
    expect(targetItems(TARGET)).toEqual([
      'WCAG', 'semantic HTML', 'ARIA', 'keyboard navigation', 'focus management', 'screen readers', 'accessibility testing',
    ]);
  });

  it('returns nothing for a requirement without a list', () => {
    expect(targetItems('Track record of measurable impact on conversion or site performance.')).toEqual([]);
  });
});

describe('coverage', () => {
  it('counts only the parts the sources support, so WCAG is never required', () => {
    const c = coverage('Built ARIA combobox semantics', NOTES, TARGET);
    expect(c.supported).toEqual(['ARIA', 'keyboard navigation', 'focus management', 'screen readers', 'accessibility testing']);
    expect(c.needed).toBe(4);
  });

  it('treats VoiceOver and NVDA as screen readers, and tested/testing as the same word', () => {
    const c = coverage(
      'Built ARIA combobox semantics, keyboard navigation, and focus management; tested accessibility with VoiceOver and NVDA.',
      NOTES,
      TARGET,
    );
    expect(c.missing).toEqual([]);
  });

  it('lists what a vague bullet leaves out', () => {
    expect(coverage('Developed accessibility features including ARIA support.', NOTES, TARGET).missing).toContain('keyboard navigation');
  });
});

describe('termsNotInSources with implied terms', () => {
  it('accepts HTML when the sources describe HTML elements', () => {
    expect(termsNotInSources('Used semantic HTML headings', NOTES)).toEqual([]);
  });
});

describe('claimCoveredBySources', () => {
  const footer = 'Engineered an enterprise-wide global web footer and UI library using React 18 and TypeScript';

  it('dismisses a flag that restates the source', () => {
    expect(claimCoveredBySources('using React 18 and TypeScript', footer)).toBe(true);
  });

  it('dismisses a flag that rewords the source with different word forms', () => {
    const full = `${footer}; utilized strict modularity to enable diverse internal business verticals and tech integration partners to seamlessly consume the code.`;
    expect(claimCoveredBySources('enabling seamless consumption by diverse business verticals and partners', full)).toBe(true);
  });

  it('treats generic build verbs as interchangeable', () => {
    expect(claimCoveredBySources('Developed a modular, enterprise UI library and global web footer', footer + '; utilized strict modularity')).toBe(true);
  });

  it('still keeps a flag when the swapped-in words claim more', () => {
    expect(claimCoveredBySources('Developed and maintained', 'Worked on the checkout page and fixed bugs')).toBe(false);
    expect(claimCoveredBySources('Led the global web footer', footer)).toBe(false);
  });

  it('keeps a flag that adds something new', () => {
    expect(claimCoveredBySources('Developed and maintained', 'Worked on the checkout page and fixed bugs')).toBe(false);
  });
});

describe('avoidedWordsUsed', () => {
  const avoid = ['seamless', 'verticals', 'diverse'];

  it('catches word forms of an avoided word', () => {
    expect(avoidedWordsUsed('Enabled partners to seamlessly consume it across business verticals', avoid)).toEqual(['seamless', 'verticals']);
    expect(avoidedWordsUsed('Served each vertical', avoid)).toEqual(['verticals']);
  });

  it('passes a draft that uses none of them', () => {
    expect(avoidedWordsUsed('Built a UI library consumed by internal partners', avoid)).toEqual([]);
  });

  it('becomes a failing check with specific feedback', () => {
    const style = runCodeChecks('Built a seamless library', 'Built a library', 25, avoid).find((c) => c.id === 'style');
    expect(style).toMatchObject({ passed: false });
    expect(style?.feedback).toContain('seamless');
  });
});
