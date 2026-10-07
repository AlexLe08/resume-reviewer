import { describe, expect, it } from 'vitest';
import { findEmail, findMissingSections, findPhone, hasUsableText, runChecks } from './index';

const SAMPLE = `Jordan Lee
jordan.lee@example.com | (555) 123-4567
Experience
Frontend Engineer, Acme Corp, 2019 - 2023
Built a design system used by 12 product teams.
Education
B.S. Computer Science
Skills
TypeScript, React, Node.js
`.repeat(2);

describe('findPhone', () => {
  it('finds a US-style number', () => {
    expect(findPhone('Call (555) 123-4567 anytime')).toBe('(555) 123-4567');
  });

  it('finds an international number', () => {
    expect(findPhone('Phone: +44 20 7946 0958')).toBe('+44 20 7946 0958');
  });

  it('does not mistake a date range for a phone number', () => {
    expect(findPhone('Acme Corp, 2019 - 2023')).toBeNull();
  });
});

describe('findEmail', () => {
  it('finds an email address', () => {
    expect(findEmail('reach me at jordan.lee@example.com today')).toBe('jordan.lee@example.com');
  });

  it('returns null when there is none', () => {
    expect(findEmail('no contact info here')).toBeNull();
  });
});

describe('findMissingSections', () => {
  it('reports nothing missing for a standard resume', () => {
    expect(findMissingSections(SAMPLE)).toEqual([]);
  });

  it('reports sections that are missing', () => {
    expect(findMissingSections('Work Experience\nAcme Corp')).toEqual(['Education', 'Skills']);
  });
});

describe('hasUsableText', () => {
  it('rejects a near-empty PDF, like a scanned image', () => {
    expect(hasUsableText({ text: 'Page 1', pageCount: 1 })).toBe(false);
  });

  it('accepts a normal text resume', () => {
    expect(hasUsableText({ text: SAMPLE, pageCount: 1 })).toBe(true);
  });
});

describe('runChecks', () => {
  it('passes every check on a clean one-page resume', () => {
    const results = runChecks({ text: SAMPLE, pageCount: 1 });
    expect(results.every((r) => r.status === 'pass')).toBe(true);
  });

  it('warns about a long resume', () => {
    const length = runChecks({ text: SAMPLE, pageCount: 3 }).find((r) => r.id === 'length');
    expect(length?.status).toBe('warn');
  });
});
