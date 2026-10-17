import { describe, expect, it } from 'vitest';
import { nextTabIndex } from './tab-keys';

describe('nextTabIndex', () => {
  it('moves right and left', () => {
    expect(nextTabIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextTabIndex('ArrowLeft', 2, 3)).toBe(1);
  });
  it('wraps at both ends', () => {
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
  });
  it('ignores other keys and empty lists', () => {
    expect(nextTabIndex('Enter', 0, 3)).toBeNull();
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull();
  });
});
