import { z } from 'zod';
import { callStructured, type StructuredOutcome } from '@/lib/llm/structured';
import type { CallRecord } from '@/lib/llm/usage';
import { claimCoveredBySources, coverage, runCodeChecks, type CheckResult } from './checks';

/**
 * Bullet improvement as an evaluator–optimizer loop, producing candidates:
 *   one call drafts several candidates from different angles
 *   → each is checked (code, then a model judge)
 *   → only failing candidates are revised, with their specific failures
 *   → the person picks from the candidates that passed.
 *
 * Code enforces safety (nothing invented) and the person's own style rules;
 * the person judges quality by choosing. Their ratings showed quality is
 * taste: very different phrasings were all "use as is".
 */

export interface BulletTask {
  /** Context only, e.g. "Software Engineer II, search team". Never treated as a source of facts. */
  role?: string;
  /** The bullet to improve. Empty means: write new bullets from the notes. */
  bullet: string;
  /** A requirement the bullet should speak to. Not a source of facts. */
  target?: string;
  /** True details from the candidate that the resume doesn't say yet. */
  notes: string[];
  maxWords: number;
  /** Words the candidate doesn't use, enforced by code. */
  avoid?: string[];
  /** The candidate's own replacements for avoided words, e.g. { verticals: 'internal partners' }. */
  prefer?: Record<string, string>;
  /** Keep code syntax (attribute names, role=…, <tags>) out of bullets. */
  noCodeSyntax?: boolean;
}

/** One problem the judge found. "relationship" means a link between facts the sources describe separately. */
export type Flag = { claim: string; kind: string; reason: string };

export interface Round {
  draft: string;
  checks: CheckResult[];
  /** Claims the judge found unsupported, after dismissing factual flags that restate the sources. */
  unsupported: Flag[];
  /** Factual judge flags dropped because every word of the claim is already in the sources. Kept for review. */
  dismissed: Flag[];
  judged: boolean;
  /** Reported only: parts of the target the sources support, and how many the draft mentions. */
  coverage?: { covered: number; supported: number };
}

export interface Candidate {
  /** What this candidate emphasizes, in the model's words, e.g. "how it was verified". */
  angle: string;
  rounds: Round[];
  status: 'passed' | 'failed';
}

export type LoopResult =
  | { status: 'done'; candidates: Candidate[]; questions: string[]; calls: CallRecord[] }
  | { status: 'error'; message: string; candidates: Candidate[]; calls: CallRecord[] };

const MAX_CANDIDATES = 3;

const DraftSchema = z.object({
  candidates: z
    .array(
      z.object({
        angle: z.string().describe('A few words on what this candidate emphasizes.'),
        bullet: z.string().describe('One bullet, one line, no leading dash.'),
      }),
    )
    .min(1)
    .max(MAX_CANDIDATES),
  questions: z
    .array(z.string())
    .max(3)
    .describe('Questions asking the candidate for facts stronger bullets would need. Empty if none.'),
});

const RevisionSchema = z.object({
  bullet: z.string().describe('The corrected bullet: one line, no leading dash.'),
});

const JudgeSchema = z.object({
  unsupported: z
    .array(
      z.object({
        claim: z.string().describe('The unsupported part of the bullet, quoted.'),
        kind: z
          .enum(['fact', 'relationship'])
          .describe('"fact": something the sources never say. "relationship": a link between facts the sources describe separately.'),
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
    task.role ? `Role (context only, don't restate it in the bullet): ${task.role}` : '',
    task.bullet ? `Original bullet: ${task.bullet}` : 'Original bullet: (none; write new bullets from the notes)',
    task.notes.length > 0 ? `Candidate's notes:\n${task.notes.map((n) => `- ${n}`).join('\n')}` : "Candidate's notes: (none)",
    ...Object.entries(task.prefer ?? {}).map(
      ([word, instead]) => `Candidate's preferred wording: "${instead}" in place of "${word}".`,
    ),
  ];
  return `<sources>\n${lines.filter(Boolean).join('\n')}\n</sources>`;
}

function rules(task: BulletTask): string {
  return [
    'Facts: use only facts stated in the sources (the original bullet and the candidate\'s notes). Never add numbers, percentages, durations, team sizes, tools, technologies, standards, or outcomes the sources don\'t state. Rephrasing is fine; new facts are not.',
    `Style: start with a strong past-tense action verb, no "I" or "my", at most ${task.maxWords} words, specific rather than vague.`,
    'Don\'t end on a generic purpose like "to improve accessibility" or "to enhance the user experience" unless the sources state that result. End on the concrete work instead.',
    task.avoid && task.avoid.length > 0 ? `Never use these words: ${task.avoid.join(', ')}.` : '',
    ...Object.entries(task.prefer ?? {}).map(([word, instead]) => `Instead of "${word}", say "${instead}".`),
    task.noCodeSyntax ? 'Name techniques, not code: write "ARIA attributes" or "semantic headings", not attribute names, role=…, or HTML tags.' : '',
    'If a target requirement is given, show how the sources\' facts relate to it. Don\'t claim any part of it the sources don\'t support, and don\'t borrow its wording as if it were a fact.',
  ]
    .filter(Boolean)
    .join('\n');
}

const JUDGE_SYSTEM = [
  'You check a resume bullet against its sources for unsupported claims.',
  'List every part of the bullet the sources do not support: added numbers, tools, technologies, standards, scope (team size, users, scale), outcomes, or responsibilities. Mark these "fact".',
  'Also list any relationship the sources do not state: the bullet saying one piece of work caused, enabled, improved, or was part of another, when the sources describe them as separate facts. Mark these "relationship".',
  'Rewording or summarizing supported facts is fine. General phrasing that clearly follows from the sources is fine.',
  'If everything is supported, return an empty list.',
].join('\n');

export interface ImproveOptions {
  maxRounds?: number;
  log?: boolean;
  signal?: AbortSignal;
  /** Called after every check of every candidate, including revisions. */
  onRound?: (candidateIndex: number, round: Round, roundIndex: number) => void;
  /** Called once with the first drafts (after removing duplicates), before any checks. */
  onDrafted?: (candidates: { angle: string; bullet: string }[], questions: string[]) => void;
  /** Called when a candidate has passed every check or run out of rounds. */
  onCandidateDone?: (candidateIndex: number, candidate: Candidate) => void;
}

export async function improveBullet(task: BulletTask, options: ImproveOptions = {}): Promise<LoopResult> {
  const maxRounds = options.maxRounds ?? 3;
  const sources = sourcesText(task);
  const calls: CallRecord[] = [];
  const target = task.target ? `\n\nTarget requirement (not a source of facts): ${task.target}` : '';

  const drafted = await callStructured({
    task: 'bullet:draft',
    system: [
      'You write resume bullets.',
      `Write up to ${MAX_CANDIDATES} candidate bullets, each from a different angle, so the candidate can choose. Choose angles that suit the sources, for example: what was built, how it was verified, what was delivered or under what constraint, who it served. Each candidate must stand alone.`,
      rules(task),
      'If stronger bullets need a fact the sources don\'t have (for example a measurable result), don\'t invent it: ask the candidate for it in "questions". Otherwise leave "questions" empty.',
    ].join('\n'),
    user: `${sourcesBlock(task)}${target}\n\nWrite the candidates.`,
    schema: DraftSchema,
    temperature: 0.6,
    signal: options.signal,
    log: options.log,
    mockResponse: () => mockDraft(task),
  });
  if (!drafted.ok) return failure(drafted, [], calls);
  calls.push(drafted.call);

  // Identical candidates waste the person's attention; keep the first of each.
  const seen = new Set<string>();
  const firstDrafts = drafted.data.candidates
    .map((c) => ({ angle: c.angle.trim(), bullet: clean(c.bullet) }))
    .filter((c) => c.bullet && !seen.has(c.bullet.toLowerCase()) && seen.add(c.bullet.toLowerCase()));

  options.onDrafted?.(firstDrafts, drafted.data.questions);

  const candidates: Candidate[] = [];
  for (const [i, first] of firstDrafts.entries()) {
    const candidate: Candidate = { angle: first.angle, rounds: [], status: 'failed' };
    candidates.push(candidate);

    let draft = first.bullet;
    for (let r = 0; r < maxRounds; r++) {
      if (r > 0) {
        const previous = candidate.rounds.at(-1)!;
        const revised = await callStructured({
          task: 'bullet:revise',
          system: ['You revise one resume bullet so it passes review.', rules(task)].join('\n'),
          user:
            `${sourcesBlock(task)}${target}\n\nThis bullet's angle: ${candidate.angle}\n\nYour previous draft:\n${previous.draft}\n\n` +
            `Problems found:\n${previous.checks.filter((c) => !c.passed).map((c) => `- ${c.feedback}`).join('\n')}\n\n` +
            'Write a corrected bullet. Fix only the problems; keep everything else that was supported.',
          schema: RevisionSchema,
          temperature: 0.4,
          signal: options.signal,
          log: options.log,
          mockResponse: () => ({ bullet: previous.draft }),
        });
        if (!revised.ok) return failure(revised, candidates, calls);
        calls.push(revised.call);
        draft = clean(revised.data.bullet);
      }

      const round = await evaluate(draft, task, sources, options, calls);
      if ('error' in round) return { status: 'error', message: round.error, candidates, calls };
      candidate.rounds.push(round);
      options.onRound?.(i, round, r);
      if (round.checks.every((c) => c.passed)) {
        candidate.status = 'passed';
        break;
      }
    }
    options.onCandidateDone?.(i, candidate);
  }

  return { status: 'done', candidates, questions: drafted.data.questions, calls };
}

/** The judge alone, for evaluate() and for testing the judge on labeled bullets. */
export async function judgeBullet(
  task: BulletTask,
  draft: string,
  options: { signal?: AbortSignal; log?: boolean } = {},
): Promise<{ ok: true; unsupported: Flag[]; dismissed: Flag[]; call: CallRecord } | { ok: false; message: string }> {
  const sources = sourcesText(task);
  const verdict = await callStructured({
    task: 'bullet:judge',
    system: JUDGE_SYSTEM,
    user: `${sourcesBlock(task)}\n\nBullet to check:\n${draft}`,
    schema: JudgeSchema,
    temperature: 0,
    signal: options.signal,
    log: options.log,
    mockResponse: () => ({ unsupported: [] }),
  });
  if (!verdict.ok) return { ok: false, message: verdict.kind === 'aborted' ? 'Aborted.' : verdict.message };
  // A relationship flag is never dismissed for reusing source words: that's exactly how a false link is made.
  const dismissible = (u: Flag) => u.kind === 'fact' && claimCoveredBySources(u.claim, sources);
  return {
    ok: true,
    unsupported: verdict.data.unsupported.filter((u) => !dismissible(u)),
    dismissed: verdict.data.unsupported.filter(dismissible),
    call: verdict.call,
  };
}

async function evaluate(
  draft: string,
  task: BulletTask,
  sources: string,
  options: ImproveOptions,
  calls: CallRecord[],
): Promise<Round | { error: string }> {
  const checks = runCodeChecks(draft, sources, task.maxWords, task.avoid ?? [], task.noCodeSyntax ?? false);
  let unsupported: Flag[] = [];
  let dismissed: Flag[] = [];
  let judged = false;

  // The judge is a second model call, so it only runs once the free code checks pass.
  if (checks.every((c) => c.passed)) {
    const verdict = await judgeBullet(task, draft, options);
    if (!verdict.ok) return { error: verdict.message };
    calls.push(verdict.call);
    judged = true;
    unsupported = verdict.unsupported;
    dismissed = verdict.dismissed;
    checks.push({
      id: 'claims',
      passed: unsupported.length === 0,
      detail: unsupported.length ? `unsupported: ${unsupported.map((u) => u.claim).join('; ')}` : 'ok',
      feedback: unsupported.length
        ? `A reviewer found claims the sources don't support: ${unsupported
            .map((u) => `"${u.claim}" (${u.kind === 'relationship' ? 'links facts the sources describe separately' : u.reason})`)
            .join('; ')}. Remove or reword them; keep separate facts separate.`
        : '',
    });
  }

  const c = task.target ? coverage(draft, sources, task.target) : null;
  return {
    draft,
    checks,
    unsupported,
    dismissed,
    judged,
    ...(c && c.supported.length > 0 ? { coverage: { covered: c.covered.length, supported: c.supported.length } } : {}),
  };
}

function clean(bullet: string): string {
  return bullet.trim().replace(/^[-•●]\s*/, '');
}

function failure(outcome: StructuredOutcome<unknown> & { ok: false }, candidates: Candidate[], calls: CallRecord[]): LoopResult {
  return {
    status: 'error',
    message: outcome.kind === 'aborted' ? 'Aborted.' : outcome.message,
    candidates,
    calls,
  };
}

/**
 * For the mock provider: the source trimmed to the word limit, and its first
 * half, so the multi-candidate path always runs with two distinct candidates.
 */
function mockDraft(task: BulletTask) {
  const words = (task.bullet || task.notes[0] || '').split(/\s+/).filter(Boolean);
  const full = words.slice(0, task.maxWords);
  return {
    candidates: [
      { angle: 'what was built', bullet: full.join(' ') },
      { angle: 'shorter', bullet: full.slice(0, Math.max(3, Math.ceil(full.length / 2))).join(' ') },
    ],
    questions: [],
  };
}
