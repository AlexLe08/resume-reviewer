import { normalizeForMatch } from '@/lib/review/grounding';
import type { LabelItem, LabelKind } from './labels';

/** What either approach reports: a word and the stretch of text around it. */
export interface Flag {
  word: string;
  context: string;
}

export interface Scored {
  /** Label ids caught, per label kind. */
  caught: Set<string>;
  /** Flags on correct terms that must not be flagged. */
  trapFlags: { flag: Flag; labelId: string }[];
  /** Flags that match no label at all. */
  unlabeled: Flag[];
  /** Flags on style calls; reported, not counted either way. */
  arguable: { flag: Flag; labelId: string }[];
}

function overlaps(flag: Flag, label: LabelItem): boolean {
  const word = normalizeForMatch(flag.word);
  const text = normalizeForMatch(label.text);
  if (!word || !text) return false;
  // "to" inside "to were" still points at the label, but only where the label sits:
  // the same word elsewhere in the resume has a different surrounding text.
  const wordMatches = word === text || text.includes(word) || word.includes(text);
  const flagContext = normalizeForMatch(flag.context);
  const labelContext = normalizeForMatch(label.context);
  return wordMatches && (flagContext.includes(labelContext) || labelContext.includes(flagContext));
}

export function scoreFlags(flags: readonly Flag[], labels: readonly LabelItem[]): Scored {
  const scored: Scored = { caught: new Set(), trapFlags: [], unlabeled: [], arguable: [] };
  for (const flag of flags) {
    const label = labels.find((l) => overlaps(flag, l));
    if (!label) scored.unlabeled.push(flag);
    else if (label.kind === 'trap') scored.trapFlags.push({ flag, labelId: label.id });
    else if (label.kind === 'arguable') scored.arguable.push({ flag, labelId: label.id });
    else scored.caught.add(label.id);
  }
  return scored;
}

export type KindCounts = Record<Exclude<LabelKind, 'trap' | 'arguable'>, { caught: number; total: number }>;

export function countByKind(scored: Scored, labels: readonly LabelItem[]): KindCounts {
  const counts: KindCounts = { nonword: { caught: 0, total: 0 }, realword: { caught: 0, total: 0 }, 'tech-casing': { caught: 0, total: 0 } };
  for (const label of labels) {
    if (label.kind === 'trap' || label.kind === 'arguable') continue;
    counts[label.kind].total++;
    if (scored.caught.has(label.id)) counts[label.kind].caught++;
  }
  return counts;
}
