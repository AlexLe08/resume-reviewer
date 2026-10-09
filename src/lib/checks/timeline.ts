import type { CheckResult } from './index';

export interface YearMonth {
  year: number;
  /** 1–12 */
  month: number;
}

export interface DateRange {
  /** The text that matched, e.g. "May 2023 – Dec 2024". */
  raw: string;
  start: YearMonth;
  end: YearMonth | 'present';
}

export interface Timeline {
  ranges: DateRange[];
  /** True if any range is ongoing ("Present") or ends in the future (e.g. an expected graduation date). */
  current: boolean;
  latestEnd: YearMonth | null;
    /** The finished range with the latest end date, kept so its exact text can be quoted. */
  latestRange: (DateRange & { end: YearMonth }) | null;
  /** Whole months from the latest end date to today. Null if there's a current role or no dates at all. */
  monthsSinceLatestEnd: number | null;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Building blocks for one point in time: "May 2023", "Sept. 2020", "06/2019", or "2019".
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const YEAR = '(?:19|20)\\d{2}';
const POINT = `(?:${MONTH}\\s+${YEAR}|\\d{1,2}\\/${YEAR}|${YEAR})`;
const ONGOING = '(?:present|current|now|today|ongoing)';
const SEPARATOR = '\\s*(?:[-–—]|to|until)\\s*';
// The lookarounds stop matches starting or ending in the middle of a word or number.
const RANGE = new RegExp(`(?<![\\w/])(${POINT})${SEPARATOR}(${POINT}|${ONGOING})(?![\\w/])`, 'gi');

/**
 * Finds date ranges anywhere in the text. It can't yet tell work history from
 * education (that needs layout information), so a degree "2024 – Present"
 * counts as current. That error hides a gap rather than inventing one, which
 * is the safer direction for feedback a person will act on.
 */
export function findDateRanges(text: string): DateRange[] {
  const ranges: DateRange[] = [];
  for (const match of text.matchAll(RANGE)) {
    const [raw, startText = '', endText = ''] = match;
    const start = parsePoint(startText, 'start');
    const end = new RegExp(`^${ONGOING}$`, 'i').test(endText) ? 'present' : parsePoint(endText, 'end');
    if (!start || !end) continue;
    if (end !== 'present' && compare(start, end) > 0) continue; // Reversed: not a real range.
    ranges.push({ raw: raw.replace(/\s+/g, ' ').trim(), start, end });
  }
  return ranges;
}

/**
 * Year-only dates are read generously: a start year means January and an end
 * year means December. That can only make a gap look shorter, never longer.
 */
function parsePoint(text: string, edge: 'start' | 'end'): YearMonth | null {
  const year = Number(text.match(/(?:19|20)\d{2}/)?.[0]);
  if (!year) return null;

  const numeric = text.match(/^(\d{1,2})\//);
  if (numeric) {
    const month = Number(numeric[1]);
    return month >= 1 && month <= 12 ? { year, month } : null;
  }

  const word = text.match(/^[a-z]+/i)?.[0]?.toLowerCase();
  if (word) {
    const month = MONTHS[word];
    return month ? { year, month } : null;
  }

  return { year, month: edge === 'start' ? 1 : 12 };
}

export function analyzeTimeline(text: string, today: Date): Timeline {
  const ranges = findDateRanges(text);
  const now: YearMonth = { year: today.getFullYear(), month: today.getMonth() + 1 };

  const current = ranges.some((r) => r.end === 'present' || compare(r.end, now) >= 0);
  const finished = ranges.filter((r): r is DateRange & { end: YearMonth } => r.end !== 'present');
  const latestRange = finished.reduce<(DateRange & { end: YearMonth }) | null>(
    (latest, r) => (latest === null || compare(r.end, latest.end) > 0 ? r : latest),
    null,
  );
  const latestEnd = latestRange?.end ?? null;

  return {
    ranges,
    current,
    latestEnd,
    latestRange,
    monthsSinceLatestEnd: current || latestEnd === null ? null : monthIndex(now) - monthIndex(latestEnd),
  };
}

/** A gap shorter than this is ordinary time between jobs. */
const GAP_WARN_MONTHS = 4;

export function checkTimeline(timeline: Timeline): CheckResult {
  const base = { id: 'timeline', label: 'Employment timeline' };

  if (timeline.ranges.length === 0) {
    return {
      ...base,
      status: 'warn',
      detail:
        'No date ranges found (like "May 2021 – Present"). Recruiters and parsers both expect dates on each role.',
    };
  }
  if (timeline.current) {
    return { ...base, status: 'pass', detail: 'Lists a current role.' };
  }

  const months = timeline.monthsSinceLatestEnd ?? 0;
  const ended = formatYearMonth(timeline.latestEnd!);
  if (months < GAP_WARN_MONTHS) {
    return { ...base, status: 'pass', detail: `Most recent role ended ${ended}.` };
  }
  return {
    ...base,
    status: 'warn',
    detail:
      `Most recent role ended ${ended}, ${formatDuration(months)} ago, and no current role is listed. ` +
      'Recruiters will ask about this. A line about what you have been doing since (projects, study, ' +
      'freelance work, or other commitments) answers the question before it comes up.',
  };
}

/**
 * Plain statements for the reviewer prompt. The model reads these instead of
 * doing date arithmetic itself, which small models get wrong.
 *
 * The one piece of resume text included is the date range itself, so the model
 * has something exact to quote. It's safe: the range only exists if it matched
 * the date pattern, so it can only contain month names, digits, dashes,
 * "to", and words like "Present".
 */
export function timelineFacts(timeline: Timeline): string[] {
  if (timeline.ranges.length === 0) return [];
  // Only state facts worth reacting to. A sentence like "the resume lists a
  // current role" adds nothing, and evals showed it crowding out other
  // feedback (typo detection dropped from 3/3 to 3/11 with it present).
  if (timeline.current) return [];
  const { latestRange, monthsSinceLatestEnd } = timeline;
  if (latestRange === null || monthsSinceLatestEnd === null) return [];
  return [
    `The latest dates on the resume are "${latestRange.raw}", which ended ` +
      `${formatDuration(monthsSinceLatestEnd)} before today.`,
  ];
}

export function formatDuration(months: number): string {
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const yearText = `${years} year${years === 1 ? '' : 's'}`;
  return rest === 0 ? yearText : `${yearText} and ${rest} month${rest === 1 ? '' : 's'}`;
}

function formatYearMonth({ year, month }: YearMonth): string {
  return `${MONTH_LABELS[month - 1]} ${year}`;
}

function monthIndex({ year, month }: YearMonth): number {
  return year * 12 + month;
}

function compare(a: YearMonth, b: YearMonth): number {
  return monthIndex(a) - monthIndex(b);
}
