import { z } from 'zod';
import { callStructured } from '@/lib/llm/structured';
import type { CallRecord } from '@/lib/llm/usage';
import { claimCoveredBySources, coverage, runCodeChecks, type CheckResult } from './checks';

/**
 * Bullet improvement as an evaluator–optimizer loop:
 *   draft → check (code, then a model judge) → revise with the failures → …
 *
 * Code runs the loop and every check, every round; the model decides how to
 * fix what failed. A model that chose when to check itself could skip the
 * checks, and these checks are what stop invented achievements.
 */

export interface BulletTask {
  /** Context only, e.g. "Software Engineer II, search team". Never treated as a source of facts. */
  role?: string;
  /** The bullet to improve. Empty means: write a new bullet from the notes. */
  bullet: string;
  /** A requirement the bullet should speak to. Not a source of facts. */
  target?: string;
  /** True details from the candidate that the resume doesn't say yet. */
  notes: string[];
  maxWords: number;
}

export interface Round {
  draft: string;
  questions: string[];
  checks: CheckResult[];
  /** Claims the judge found unsupported. Empty if the judge didn't run (code checks failed first) or found none. */
  unsupported: { claim: string; reason: string }[];
  /** Judge flags dropped because every word of the claim is already in the sources. Kept for review. */
  dismissed: { claim: string; reason: string }[];
  judged: boolean;
  /** Reported only: parts of the target the sources support, and how many the draft mentions. */
  coverage?: { covered: number; supported: number };
}

export type LoopResult =
  | { status: 'passed' | 'failed'; rounds: Round[]; calls: CallRecord[] }
  | { status: 'error'; message: string; rounds: Round[]; calls: CallRecord[] };

const DraftSchema = z.object({
  bullet: z.string().describe('The improved bullet: one line, no leading dash.'),
  questions: z
    .array(z.string())
    .max(3)
    .describe('Questions asking the candidate for facts a stronger bullet would need. Empty if none.'),
});

const JudgeSchema = z.object({
  unsupported: z
    .array(
      z.object({
        claim: z.string().describe('The unsupported part of the bullet, quoted.'),
        reason: z.string().describe('Briefly, why the sources do not support it.'),
      }),
    )
    .max(6),
});

/** The only text facts may come from. The role and target are deliberately excluded. */
export function sourcesText(task: BulletTask): string {
  return [task.bullet, ...task.notes].filter(Boolean).join('\n');
}

function sourcesBlock(task: BulletTask): string {
  const lines = [
    task.role ? `Role (context only): ${task.role}` : '',
    task.bullet ? `Original bullet: ${task.bullet}` : 'Original bullet: (none; write a new bullet from the notes)',
    task.notes.length > 0 ? `Candidate's notes:\n${task.notes.map((n) => `- ${n}`).join('\n')}` : "Candidate's notes: (none)",
  ];
  return `<sources>\n${lines.filter(Boolean).join('\n')}\n</sources>`;
}

const DRAFT_SYSTEM = (maxWords: number) =>
  [
    'You improve a single resume bullet.',
    '',
    'Facts: use only facts stated in the sources (the original bullet and the candidate\'s notes). Never add numbers, percentages, durations, team sizes, tools, technologies, standards, or outcomes the sources don\'t state. Rephrasing is fine; new facts are not.',
    `Style: one bullet, starting with a strong past-tense action verb, no "I" or "my", at most ${maxWords} words, specific rather than vague.`,
    'If a target requirement is given, show how the sources\' facts relate to it. Do not claim any part of it the sources don\'t support, and don\'t borrow its wording as if it were a fact.',
    'If a stronger bullet needs a fact the sources don\'t have (for example a measurable result), don\'t invent it. Write the best honest bullet without it, and ask the candidate for that fact in "questions". Otherwise leave "questions" empty.',
  ].join('\n');

const JUDGE_SYSTEM = [
  'You check a resume bullet against its sources for unsupported claims.',
  'List every part of the bullet the sources do not support: added numbers, tools, technologies, standards, scope (team size, users, scale), outcomes, or responsibilities.',
  'Rewording or summarizing supported facts is fine. General phrasing that clearly follows from the sources is fine.',
  'If everything is supported, return an empty list.',
].join('\n');

export interface ImproveOptions {
  maxRounds?: number;
  log?: boolean;
  signal?: AbortSignal;
  onRound?: (round: Round, index: number) => void;
}

export async function improveBullet(task: BulletTask, options: ImproveOptions = {}): Promise<LoopResult> {
  const maxRounds = options.maxRounds ?? 4;
  const sources = sourcesText(task);
  const rounds: Round[] = [];
  const calls: CallRecord[] = [];
  const target = task.target ? `\n\nTarget requirement (not a source of facts): ${task.target}` : '';

  for (let i = 0; i < maxRounds; i++) {
    const previous = rounds.at(-1);
    const user = previous
      ? `${sourcesBlock(task)}${target}\n\nYour previous draft:\n${previous.draft}\n\nProblems found:\n${problemsOf(previous)
          .map((p) => `- ${p}`)
          .join('\n')}\n\nWrite a corrected bullet.`
      : `${sourcesBlock(task)}${target}\n\nWrite the improved bullet.`;

    const drafted = await callStructured({
      task: 'bullet:draft',
      system: DRAFT_SYSTEM(task.maxWords),
      user,
      schema: DraftSchema,
      temperature: 0.4,
      signal: options.signal,
      log: options.log,
      mockResponse: () => mockDraft(task),
    });
    if (!drafted.ok) return failure(drafted, rounds, calls);
    calls.push(drafted.call);

    const draft = drafted.data.bullet.trim().replace(/^[-•●]\s*/, '');
    const checks = runCodeChecks(draft, sources, task.maxWords);
    let unsupported: Round['unsupported'] = [];
    let dismissed: Round['dismissed'] = [];
    let judged = false;

    // The judge is a second model call, so it only runs once the free code checks pass.
    if (checks.every((c) => c.passed)) {
      const judgedCall = await callStructured({
        task: 'bullet:judge',
        system: JUDGE_SYSTEM,
        user: `${sourcesBlock(task)}\n\nBullet to check:\n${draft}`,
        schema: JudgeSchema,
        temperature: 0,
        signal: options.signal,
        log: options.log,
        mockResponse: () => ({ unsupported: [] }),
      });
      if (!judgedCall.ok) return failure(judgedCall, rounds, calls);
      calls.push(judgedCall.call);
      judged = true;
      unsupported = judgedCall.data.unsupported.filter((u) => !claimCoveredBySources(u.claim, sources));
      dismissed = judgedCall.data.unsupported.filter((u) => claimCoveredBySources(u.claim, sources));
      checks.push({
        id: 'claims',
        passed: unsupported.length === 0,
        detail: unsupported.length ? `unsupported: ${unsupported.map((u) => u.claim).join('; ')}` : 'ok',
        feedback: unsupported.length
          ? `A reviewer found claims the sources don't support: ${unsupported.map((u) => `"${u.claim}" (${u.reason})`).join('; ')}. Remove or reword them.`
          : '',
      });
    }

    const c = task.target ? coverage(draft, sources, task.target) : null;
    const round: Round = {
      draft,
      questions: drafted.data.questions,
      checks,
      unsupported,
      dismissed,
      judged,
      ...(c && c.supported.length > 0 ? { coverage: { covered: c.covered.length, supported: c.supported.length } } : {}),
    };
    rounds.push(round);
    options.onRound?.(round, i);
    if (checks.every((c) => c.passed)) return { status: 'passed', rounds, calls };
  }
  return { status: 'failed', rounds, calls };
}

function problemsOf(round: Round): string[] {
  return round.checks.filter((c) => !c.passed).map((c) => c.feedback);
}

function failure(
  outcome: { ok: false; kind: string; message?: string },
  rounds: Round[],
  calls: CallRecord[],
): LoopResult {
  return { status: 'error', message: outcome.kind === 'aborted' ? 'Aborted.' : (outcome.message ?? 'Failed.'), rounds, calls };
}

/** For the mock provider: the source trimmed to length, with no questions. */
function mockDraft(task: BulletTask) {
  const source = task.bullet || task.notes[0] || '';
  return { bullet: source.split(/\s+/).slice(0, task.maxWords).join(' '), questions: [] };
}
