import { describe, expect, it } from 'vitest';
import {
  analyzeTimeline,
  checkTimeline,
  findDateRanges,
  formatDuration,
  timelineFacts,
  totalCoveredMonths,
} from './timeline';

// Fixed "today" so results don't change as real time passes.
const TODAY = new Date(2026, 9, 8); // 8 Oct 2026 (months are 0-based in Date)

describe('findDateRanges', () => {
  // [input, expected start, expected end] — one row per format we've seen in real resumes.
  const cases: [string, string, string][] = [
    ['May 2023 – Dec 2024', '2023-5', '2024-12'],
    ['Apr 2021 - Mar 2024', '2021-4', '2024-3'],
    ['Sept. 2020 to Jan 2021', '2020-9', '2021-1'],
    ['January 2020 — Current', '2020-1', 'present'],
    ['Mar 2022 – Present', '2022-3', 'present'],
    ['2021–Present', '2021-1', 'present'],
    ['06/2019 - 03/2021', '2019-6', '2021-3'],
    ['2015 - 2019', '2015-1', '2019-12'],
    ['May 2023 –\nDec 2024', '2023-5', '2024-12'],
    ['Software Engineer II - CVS Search | CVS Health | Woonsocket, RI May 2023 – Dec 2024', '2023-5', '2024-12'],
  ];

  it.each(cases)('reads %j', (input, start, end) => {
    const [range] = findDateRanges(input);
    expect(range).toBeDefined();
    expect(`${range!.start.year}-${range!.start.month}`).toBe(start);
    expect(range!.end === 'present' ? 'present' : `${range!.end.year}-${range!.end.month}`).toBe(end);
  });

  it.each([
    ['a phone number', '(206) 555-0142'],
    ['a single graduation year', 'B.S. Computer Science | University of Washington | 2018'],
    ['an impossible month', '13/2019 - 03/2021'],
    ['a reversed range', 'Dec 2024 – May 2023'],
    ['a word that starts like a month', 'Mayor 2020 campaign'],
  ])('ignores %s', (_label, input) => {
    expect(findDateRanges(input)).toEqual([]);
  });
});

describe('analyzeTimeline', () => {
  it('measures the gap since the most recent end date', () => {
    const timeline = analyzeTimeline('Jun 2019 – Mar 2021\nApr 2021 – Mar 2024', TODAY);
    expect(timeline).toMatchObject({
      current: false,
      latestEnd: { year: 2024, month: 3 },
      latestRange: { raw: 'Apr 2021 – Mar 2024' },
      monthsSinceLatestEnd: 31,
    });
  });

  it('treats any ongoing range as a current role', () => {
    const timeline = analyzeTimeline('Jun 2019 – Mar 2021\nApr 2021 – Present', TODAY);
    expect(timeline).toMatchObject({ current: true, monthsSinceLatestEnd: null });
  });

  it('treats a future end date (like expected graduation) as current', () => {
    expect(analyzeTimeline('Aug 2023 – May 2027', TODAY).current).toBe(true);
  });

  it('reports no dates when there are none', () => {
    expect(analyzeTimeline('No dates here', TODAY)).toMatchObject({ ranges: [], latestEnd: null });
  });
});

describe('checkTimeline', () => {
  it('warns about a long gap', () => {
    const result = checkTimeline(analyzeTimeline('May 2023 – Dec 2024', TODAY));
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('Dec 2024, 1 year and 10 months ago');
  });

  it('passes a short gap', () => {
    expect(checkTimeline(analyzeTimeline('Jan 2024 – Aug 2026', TODAY)).status).toBe('pass');
  });

  it('passes a current role', () => {
    expect(checkTimeline(analyzeTimeline('Mar 2022 – Present', TODAY)).status).toBe('pass');
  });

  it('warns when there are no dates', () => {
    expect(checkTimeline(analyzeTimeline('Frontend Engineer, Acme', TODAY)).status).toBe('warn');
  });
});

describe('timelineFacts', () => {
  it('states the gap in plain words for the model', () => {
    expect(timelineFacts(analyzeTimeline('Apr 2021 – Mar 2024', TODAY))).toEqual([
      'The latest dates on the resume are "Apr 2021 – Mar 2024", which ended 2 years and 7 months before today.',
    ]);
  });

  it('says nothing when there is a current role', () => {
    expect(timelineFacts(analyzeTimeline('Mar 2022 – Present', TODAY))).toEqual([]);
  });

  it('says nothing when no dates were found', () => {
    expect(timelineFacts(analyzeTimeline('No dates', TODAY))).toEqual([]);
  });
});

describe('totalCoveredMonths', () => {
  const months = (text: string) => totalCoveredMonths(analyzeTimeline(text, TODAY), TODAY);

  it('joins back-to-back roles without double-counting the shared month', () => {
    // Nov 2020 → Dec 2024 is 49 months.
    expect(months('Nov 2020 – May 2021\nMay 2021 – May 2023\nMay 2023 – Dec 2024')).toBe(49);
  });

  it('leaves out gaps between roles', () => {
    expect(months('Jan 2020 – Jan 2021\nJan 2022 – Jan 2023')).toBe(24);
  });

  it('merges overlapping roles', () => {
    expect(months('Jan 2020 – Jan 2022\nJun 2021 – Jan 2023')).toBe(36);
  });

  it('counts a current role up to today', () => {
    expect(months('Oct 2025 – Present')).toBe(12);
  });
});

describe('formatDuration', () => {
  it.each([
    [1, '1 month'],
    [11, '11 months'],
    [12, '1 year'],
    [31, '2 years and 7 months'],
  ])('%i months → %s', (months, text) => {
    expect(formatDuration(months)).toBe(text);
  });
});
