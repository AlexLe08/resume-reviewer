import { describe, expect, it } from 'vitest';
import { parseReview, reviewJsonSchema } from './schema';

const VALID = {
  summary: 'Clear frontend profile with measurable impact.',
  wouldAdvance: 'yes',
  strengths: [{ point: 'Quantified impact', evidence: 'used by 12 product teams' }],
  issues: [
    {
      severity: 'low',
      problem: 'No summary line',
      evidence: '',
      suggestion: 'Add one line stating the role you are targeting.',
    },
  ],
};

describe('parseReview', () => {
  it('accepts a well-formed review', () => {
    const result = parseReview(JSON.stringify(VALID));
    expect(result.success).toBe(true);
  });

  it('rejects text that is not JSON', () => {
    const result = parseReview('Sure! Here is my review: ...');
    expect(result.success).toBe(false);
  });

  it('rejects JSON with the wrong shape', () => {
    const result = parseReview(JSON.stringify({ ...VALID, wouldAdvance: 'definitely' }));
    expect(result.success).toBe(false);
  });
});

describe('reviewJsonSchema', () => {
  it('produces an object schema without the $schema key', () => {
    const schema = reviewJsonSchema();
    expect(schema.type).toBe('object');
    expect(schema).not.toHaveProperty('$schema');
  });
});
