import { countByKind, scoreFlags, type Flag, type KindCounts, type Scored } from './score';
import type { LabelItem } from './labels';

/** One scored proofreading run on one labeled resume. */
export interface ProofreadResult {
  approach: 'model';
  run: number;
  latencyMs: number;
  kinds: KindCounts;
  trapsFlagged: number;
  trapsTotal: number;
  unlabeled: number;
  arguable: number;
  /** Findings whose quote isn't in the resume. */
  ungrounded: number;
  flags: Flag[];
  scored: { caught: string[]; trapFlags: unknown[]; unlabeled: Flag[]; arguable: unknown[] };
}

export function summarizeFlags(
  approach: 'model',
  run: number,
  latencyMs: number,
  flags: Flag[],
  labels: LabelItem[],
  ungrounded = 0,
): ProofreadResult {
  const scored: Scored = scoreFlags(flags, labels);
  return {
    approach,
    run,
    latencyMs,
    kinds: countByKind(scored, labels),
    trapsFlagged: new Set(scored.trapFlags.map((t) => t.labelId)).size,
    trapsTotal: labels.filter((l) => l.kind === 'trap').length,
    unlabeled: scored.unlabeled.length,
    arguable: scored.arguable.length,
    ungrounded,
    flags,
    scored: { caught: [...scored.caught], trapFlags: scored.trapFlags, unlabeled: scored.unlabeled, arguable: scored.arguable },
  };
}

/** Counts only, so it is safe to print: no resume text. */
export function formatResultLine(r: ProofreadResult): string {
  const k = r.kinds;
  const frac = (c: { caught: number; total: number }) => (c.total === 0 ? '  -  ' : `${c.caught}/${c.total}`.padStart(5));
  return (
    `  ${r.approach.padEnd(6)} nonword ${frac(k.nonword)}  realword ${frac(k.realword)}  casing ${frac(k['tech-casing'])}  ` +
    `traps flagged ${r.trapsFlagged}/${r.trapsTotal}  other false alarms ${r.unlabeled}  style calls ${r.arguable}` +
    `  ungrounded ${r.ungrounded}` +
    `  ${r.latencyMs} ms`
  );
}
