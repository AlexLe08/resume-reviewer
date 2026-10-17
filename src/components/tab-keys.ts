/**
 * Where focus and selection go when an arrow key is pressed on a tab, or null
 * for any other key. Wraps around at both ends, as screen-reader users expect
 * from a tab list. Kept apart from the component so it can be tested without a browser.
 */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index + count - 1) % count;
  return null;
}
