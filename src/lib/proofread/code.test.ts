import { describe, expect, it } from 'vitest';
import { checkSpelling } from './code';

describe('checkSpelling', () => {
  it('flags a misspelling with a suggestion and context, and leaves technology and company names alone', async () => {
    const issues = await checkSpelling('Built the bookign flow with Playwright, Next.js and Akamai.');
    expect(issues.map((i) => i.word)).toEqual(['bookign']);
    expect(issues[0]?.suggestions).toContain('booking');
    expect(issues[0]?.context).toContain('the bookign flow');
  });
}, 30_000);
