import type { AssertionKind, AssertionResult } from './assertions';

export type Verdict = 'yes' | 'maybe' | 'no';

export interface RunRecord {
  fixture: string;
  run: number;
  status: 'ok' | 'llm_error' | 'invalid_output';
  error?: string;
  latencyMs?: number;
  outputTokens?: number;
  verdict?: Verdict;
  grounding?: { quotes: number; found: number };
  assertions: AssertionResult[];
  /** The full review, kept so failures can be inspected afterwards. */
  review?: unknown;
}

export interface AssertionSummary {
  id: string;
  kind: AssertionKind;
  label: string;
  passed: number;
  total: number;
}

export interface FixtureSummary {
  fixture: string;
  runs: number;
  validRuns: number;
  verdicts: Record<Verdict, number>;
  quotes: number;
  quotesFound: number;
  avgLatencyMs: number | null;
  avgOutputTokens: number | null;
  assertions: AssertionSummary[];
}

export function summarize(records: RunRecord[]): FixtureSummary[] {
  const byFixture = new Map<string, RunRecord[]>();
  for (const record of records) {
    byFixture.set(record.fixture, [...(byFixture.get(record.fixture) ?? []), record]);
  }

  return [...byFixture].map(([fixture, runs]) => {
    const valid = runs.filter((r) => r.status === 'ok');
    const verdicts: Record<Verdict, number> = { yes: 0, maybe: 0, no: 0 };
    for (const r of valid) if (r.verdict) verdicts[r.verdict]++;

    const assertions = new Map<string, AssertionSummary>();
    for (const r of valid) {
      for (const a of r.assertions) {
        const key = `${a.kind}:${a.id}`;
        const summary = assertions.get(key) ?? { id: a.id, kind: a.kind, label: a.label, passed: 0, total: 0 };
        summary.total++;
        if (a.passed) summary.passed++;
        assertions.set(key, summary);
      }
    }

    return {
      fixture,
      runs: runs.length,
      validRuns: valid.length,
      verdicts,
      quotes: sum(valid.map((r) => r.grounding?.quotes ?? 0)),
      quotesFound: sum(valid.map((r) => r.grounding?.found ?? 0)),
      avgLatencyMs: average(valid.map((r) => r.latencyMs)),
      avgOutputTokens: average(valid.map((r) => r.outputTokens)),
      assertions: [...assertions.values()],
    };
  });
}

export function formatSummary(summaries: FixtureSummary[]): string {
  const lines: string[] = [];

  for (const s of summaries) {
    lines.push('', s.fixture);
    lines.push(`  valid runs   ${s.validRuns}/${s.runs}`);
    if (s.validRuns === 0) continue;
    lines.push(`  verdicts     yes ${s.verdicts.yes}, maybe ${s.verdicts.maybe}, no ${s.verdicts.no}`);
    lines.push(`  grounding    ${s.quotesFound}/${s.quotes} quotes found${percent(s.quotesFound, s.quotes)}`);
    if (s.avgLatencyMs !== null) {
      const tokens = s.avgOutputTokens !== null ? `, avg ${Math.round(s.avgOutputTokens).toLocaleString()} output tokens` : '';
      lines.push(`  time         avg ${(s.avgLatencyMs / 1000).toFixed(1)} s${tokens}`);
    }
    for (const a of s.assertions) {
      const mark = a.passed === a.total ? '✓' : a.passed === 0 ? '✗' : '~';
      lines.push(`  ${mark} ${a.passed}/${a.total}  ${a.label}`);
    }
  }

  const checks = summaries.flatMap((s) => s.assertions);
  const passed = sum(checks.map((a) => a.passed));
  const total = sum(checks.map((a) => a.total));
  const quotes = sum(summaries.map((s) => s.quotes));
  const found = sum(summaries.map((s) => s.quotesFound));
  const valid = sum(summaries.map((s) => s.validRuns));
  const runs = sum(summaries.map((s) => s.runs));

  lines.push(
    '',
    `Overall: ${passed}/${total} checks passed${percent(passed, total)}, ` +
      `${found}/${quotes} quotes found${percent(found, quotes)}, ${valid}/${runs} valid runs`,
  );
  return lines.join('\n');
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function average(values: (number | undefined)[]): number | null {
  const present = values.filter((v): v is number => v !== undefined);
  return present.length ? sum(present) / present.length : null;
}

function percent(part: number, whole: number): string {
  return whole > 0 ? ` (${Math.round((part / whole) * 100)}%)` : '';
}
