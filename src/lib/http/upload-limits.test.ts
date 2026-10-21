import { describe, expect, it } from 'vitest';
import { isTooLarge, MAX_UPLOAD_BYTES } from './upload-limits';

describe('isTooLarge', () => {
  it('allows exactly the limit and refuses one byte more', () => {
    expect(isTooLarge(MAX_UPLOAD_BYTES)).toBe(false);
    expect(isTooLarge(MAX_UPLOAD_BYTES + 1)).toBe(true);
  });
  it('stays under the 4.5 MB body limit of serverless hosts, with room for the form encoding', () => {
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024 - 64 * 1024);
  });
});
