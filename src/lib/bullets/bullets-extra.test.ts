import { describe, expect, it } from 'vitest';
import { editIssues } from './edit-issues';
import { BulletRequestSchema, DEFAULT_STYLE, isWritingStyle, parseNoteGroups, parseStyle } from './request';

describe('isWritingStyle', () => {
  it('accepts the saved shape and rejects anything else browser storage might hold', () => {
    expect(isWritingStyle(DEFAULT_STYLE)).toBe(true);
    expect(isWritingStyle(null)).toBe(false);
    expect(isWritingStyle('x')).toBe(false);
    expect(isWritingStyle({ avoidText: '', preferText: '' })).toBe(false);
    expect(isWritingStyle({ ...DEFAULT_STYLE, noCodeSyntax: 'yes' })).toBe(false);
  });
});

describe('parseStyle', () => {
  it('reads avoided words and replacements written either way', () => {
    expect(
      parseStyle({ avoidText: 'seamless, verticals ,diverse, x', preferText: 'verticals -> internal partners\nleverage → use\nnot a pair', noCodeSyntax: true }),
    ).toEqual({
      avoid: ['seamless', 'verticals', 'diverse'],
      prefer: { verticals: 'internal partners', leverage: 'use' },
      noCodeSyntax: true,
    });
  });

  it('turns the default style into no rules', () => {
    expect(parseStyle(DEFAULT_STYLE)).toEqual({ avoid: [], prefer: {}, noCodeSyntax: false });
  });
});

describe('BulletRequestSchema', () => {
  it('needs a bullet or at least one note', () => {
    expect(BulletRequestSchema.safeParse({ noteGroups: [] }).success).toBe(false);
    expect(BulletRequestSchema.safeParse({ noteGroups: [['Tested with NVDA.']] }).success).toBe(true);
  });

  it('caps the total number of notes across groups', () => {
    const many = Array.from({ length: 16 }, (_, i) => `Fact ${i}`);
    expect(BulletRequestSchema.safeParse({ noteGroups: [many.slice(0, 8), many.slice(8)] }).success).toBe(false);
  });
});

describe('editIssues', () => {
  const ctx = { bullet: '', notes: ['Tested search with VoiceOver and NVDA.'], maxWords: 11, avoid: ['seamless'], noCodeSyntax: true };

  it('says nothing about an edit that only rewords the notes', () => {
    expect(editIssues('Tested search with VoiceOver and NVDA', ctx)).toEqual([]);
  });

  it('explains each problem an edit introduces, in plain words', () => {
    const issues = editIssues('I tested seamless search with JAWS for 40% of users via aria-label', ctx);
    expect(issues).toEqual([
      "Adds 40, which isn't in your notes. If it's true, add it to your notes.",
      "Names JAWS, aria-label, which your notes don't mention.",
      '12 words; the limit is 11.',
      'Uses words you avoid: seamless.',
      'Includes code syntax: aria-label.',
      'Uses first person.',
    ]);
  });
});

describe('parseNoteGroups', () => {
  it('splits on blank lines and trims each fact', () => {
    expect(parseNoteGroups('Built the harness.\n  Ran it nightly.  \n\n\nShipped matching.\n')).toEqual([
      ['Built the harness.', 'Ran it nightly.'],
      ['Shipped matching.'],
    ]);
  });

  it('treats lines with only spaces as group breaks too', () => {
    expect(parseNoteGroups('a\n   \nb')).toEqual([['a'], ['b']]);
  });
});
