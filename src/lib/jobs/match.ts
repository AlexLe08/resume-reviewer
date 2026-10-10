import { analyzeTimeline, formatDuration, totalCoveredMonths } from '@/lib/checks/timeline'
import { callStructured, type StructuredOutcome } from '@/lib/llm/structured'
import type { ExtractedDocument } from '@/lib/pdf/extract'
import { isQuoteInText } from '@/lib/review/grounding'
import { buildMatchPrompt } from './prompt'
import {
  MATCH_STATUSES,
  MatchSchema,
  TIERS,
  type MatchReport,
  type MatchStatus,
  type Requirement,
  type RequirementMatch,
  type Tier,
} from './schema'

export interface MatchOptions {
  signal?: AbortSignal
  log?: boolean
  /** Defaults to now. Tests pass a fixed date. */
  today?: Date
}

/**
 * Step 2 of job matching: one call with the whole resume and every requirement.
 *
 * Not an agent. In the Phase 2 spike, a single call that could see the whole
 * resume got 25/25 verdicts right; a tool-using agent that searched for
 * evidence got 13/25. See DECISIONS.md, section 6.
 */
export async function matchRequirements(
  doc: ExtractedDocument,
  requirements: Requirement[],
  options: MatchOptions = {}
): Promise<StructuredOutcome<MatchReport>> {
  const today = options.today ?? new Date()
  const { system, user } = buildMatchPrompt(
    doc.text,
    requirements,
    today,
    matchFacts(doc.text, today, requirements)
  )
  const outcome = await callStructured({
    task: 'job:match',
    system,
    user,
    schema: MatchSchema,
    temperature: 0.2,
    signal: options.signal,
    log: options.log,
    mockResponse: () => mockMatch(doc.text, requirements),
  })
  if (!outcome.ok) return outcome
  return {
    ok: true,
    data: buildReport(requirements, outcome.data.results, doc.text),
    call: outcome.call,
  }
}

// "or equivalent practical experience", "or equivalent experience", "or equivalent work experience", …
const ACCEPTS_EXPERIENCE = /\bor equivalent\b[^.]*\bexperience\b/i

/**
 * Facts the model shouldn't work out itself. Years of experience is computed,
 * and any requirement that accepts experience in place of a credential is
 * pointed out next to the experience total, because a general rule in the
 * prompt wasn't enough: the model judged the degree's field instead.
 */
export function matchFacts(
  resumeText: string,
  today: Date,
  requirements: Requirement[] = []
): string[] {
  const timeline = analyzeTimeline(resumeText, today)
  if (timeline.ranges.length === 0) return []
  const experience = formatDuration(totalCoveredMonths(timeline, today))

  const facts = [
    `Total time covered by the dated roles on the resume, with overlaps merged and gaps left out: ${experience}. Use this for any "years of experience" requirement.`,
  ]
  for (const r of requirements.filter((req) => ACCEPTS_EXPERIENCE.test(req.text))) {
    facts.push(
      `Requirement ${r.id} accepts equivalent practical experience instead of the credential it names. ` +
        `The resume shows ${experience} of professional experience. Judge it on that experience, not on the field of any degree listed.`
    )
  }
  return facts
}

/**
 * Joins the model's answers to the requirements and checks them. Duplicate
 * answers keep the first; unknown ids are ignored; skipped requirements are
 * reported rather than silently filled in.
 */
export function buildReport(
  requirements: Requirement[],
  results: { id: number; status: MatchStatus; evidence: string; gap: string }[],
  resumeText: string
): MatchReport {
  const byId = new Map<number, (typeof results)[number]>()
  for (const result of results) if (!byId.has(result.id)) byId.set(result.id, result)

  const matches: RequirementMatch[] = []
  const unanswered: number[] = []
  for (const requirement of requirements) {
    const result = byId.get(requirement.id)
    if (!result) {
      unanswered.push(requirement.id)
      continue
    }
    const evidence = result.evidence.trim()
    matches.push({
      ...requirement,
      status: result.status,
      evidence,
      gap: result.gap.trim(),
      evidenceFound: evidence === '' || isQuoteInText(evidence, resumeText),
    })
  }

  const counts = Object.fromEntries(
    TIERS.map((tier) => [tier, Object.fromEntries(MATCH_STATUSES.map((s) => [s, 0]))])
  ) as Record<Tier, Record<MatchStatus, number>>
  for (const match of matches) counts[match.tier][match.status]++

  return { matches, unanswered, counts }
}

/** For the mock provider: the first requirement met with a real resume line, the rest missing. */
function mockMatch(resumeText: string, requirements: Requirement[]) {
  const line =
    resumeText
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length >= 40) ?? ''
  return {
    results: requirements.map((r, i) => ({
      id: r.id,
      status: i === 0 ? 'met' : 'missing',
      evidence: i === 0 ? line : '',
      gap: i === 0 ? '' : '[Mock] Not checked: no model was called.',
    })),
  }
}
