import { analyzeTimeline, formatDuration, totalCoveredMonths } from '@/lib/checks/timeline'
import { callStructured, type StructuredOutcome } from '@/lib/llm/structured'
import type { ExtractedDocument } from '@/lib/pdf/extract'
import { isQuoteInText } from '@/lib/review/grounding'
import { createArrayItemReader } from '@/lib/stream/json-items'
import { buildMatchPrompt } from './prompt'
import {
  MATCH_STATUSES,
  MatchItemSchema,
  MatchSchema,
  TIERS,
  type MatchItem,
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
  /**
   * Called with each requirement's result as soon as the model finishes it,
   * with the same checks as the final report (grounding, computed evidence,
   * filled gaps). The final report is still the source of truth.
   */
  onMatch?: (match: RequirementMatch) => void
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
  const computed = computedEvidence(requirements, doc.text, today)

  let onDelta: ((text: string) => void) | undefined
  if (options.onMatch) {
    const reader = createArrayItemReader('results')
    const byId = new Map(requirements.map((r) => [r.id, r]))
    const sent = new Set<number>()
    const emit = options.onMatch
    onDelta = (text) => {
      for (const item of reader.push(text)) {
        const parsed = MatchItemSchema.safeParse(item)
        if (!parsed.success) continue
        const requirement = byId.get(parsed.data.id)
        // Same rules as buildReport: unknown ids are ignored, the first answer per requirement wins.
        if (!requirement || sent.has(requirement.id)) continue
        sent.add(requirement.id)
        emit(toRequirementMatch(requirement, parsed.data, doc.text, computed.get(requirement.id)))
      }
    }
  }

  const outcome = await callStructured({
    task: 'job:match',
    system,
    user,
    schema: MatchSchema,
    temperature: 0.2,
    signal: options.signal,
    log: options.log,
    onDelta,
    mockResponse: () => mockMatch(doc.text, requirements),
  })
  if (!outcome.ok) return outcome
  return {
    ok: true,
    data: buildReport(requirements, outcome.data.results, doc.text, computed),
    call: outcome.call,
  }
}

// "or equivalent practical experience", "or equivalent experience", "or equivalent work experience", …
const ACCEPTS_EXPERIENCE = /\bor equivalent\b[^.]*\bexperience\b/i

// "5+ years", "3 years", "6+ yrs"
const STATES_YEARS = /\b\d+\s*\+?\s*(?:years?|yrs)\b/i

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

  // The ranges themselves are quoted so the model has real resume text to cite as
  // evidence. Safe to include: a range only exists if it matched the date pattern.
  const quoted = timeline.ranges
    .slice(0, 6)
    .map((r) => `"${r.raw}"`)
    .join(', ')

  const facts = [
    `Total time covered by the resume's date ranges (${quoted}), with overlaps merged and gaps left out: ${experience}. ` +
      'Use this for any "years of experience" requirement, and quote one of those date ranges as its evidence.',
  ]
  for (const r of requirements.filter((req) => ACCEPTS_EXPERIENCE.test(req.text))) {
    facts.push(
      `Requirement ${r.id} accepts equivalent practical experience instead of the credential it names. ` +
        `The resume shows ${experience} of professional experience (the date ranges above). ` +
        'Judge it on that experience, not on the field of any degree listed, and quote one of those date ranges as its evidence.'
    )
  }
  return facts
}

/**
 * Evidence for requirements answered from computed facts. For these, the
 * calculation IS the evidence: no single resume line proves "8 years", so a
 * model-chosen quote was always going to be weak or wrong (one-role date
 * ranges, or our own fact text). The model still decides the status.
 */
export function computedEvidence(
  requirements: Requirement[],
  resumeText: string,
  today: Date
): Map<number, string> {
  const evidence = new Map<number, string>()
  const timeline = analyzeTimeline(resumeText, today)
  if (timeline.ranges.length === 0) return evidence
  const total = formatDuration(totalCoveredMonths(timeline, today))
  // Oldest first, so the list reads as a timeline.
  const ranges = [...timeline.ranges]
    .sort((a, b) => a.start.year * 12 + a.start.month - (b.start.year * 12 + b.start.month))
    .map((r) => r.raw)
    .join(', ')
  for (const r of requirements) {
    if (STATES_YEARS.test(r.text) || ACCEPTS_EXPERIENCE.test(r.text)) {
      evidence.set(r.id, `${total} of experience (${ranges})`)
    }
  }
  return evidence
}

/**
 * Joins the model's answers to the requirements and checks them. Duplicate
 * answers keep the first; unknown ids are ignored; skipped requirements are
 * reported rather than silently filled in.
 */
export function buildReport(
  requirements: Requirement[],
  results: MatchItem[],
  resumeText: string,
  computed: Map<number, string> = new Map()
): MatchReport {
  const byId = new Map<number, MatchItem>()
  for (const result of results) if (!byId.has(result.id)) byId.set(result.id, result)

  const matches: RequirementMatch[] = []
  const unanswered: number[] = []
  for (const requirement of requirements) {
    const result = byId.get(requirement.id)
    if (!result) {
      unanswered.push(requirement.id)
      continue
    }
    matches.push(toRequirementMatch(requirement, result, resumeText, computed.get(requirement.id)))
  }

  const counts = Object.fromEntries(
    TIERS.map((tier) => [tier, Object.fromEntries(MATCH_STATUSES.map((s) => [s, 0]))])
  ) as Record<Tier, Record<MatchStatus, number>>
  for (const match of matches) counts[match.tier][match.status]++

  return { matches, unanswered, counts }
}

/** One requirement's result, checked. Shared by the streamed results and the final report. */
export function toRequirementMatch(
  requirement: Requirement,
  result: MatchItem,
  resumeText: string,
  computedText: string | undefined
): RequirementMatch {
  const evidence = computedText ?? result.evidence.trim()
  const modelGap = result.gap.trim()
  // For "missing", the explanation is nearly always "it isn't on the resume", so code can say it.
  const fillGap = modelGap === '' && result.status === 'missing'
  return {
    ...requirement,
    status: result.status,
    evidence,
    gap: fillGap ? 'Not shown on the resume.' : modelGap,
    evidenceFound:
      computedText !== undefined || evidence === '' || isQuoteInText(evidence, resumeText),
    ...(computedText !== undefined ? { evidenceComputed: true } : {}),
    ...(fillGap ? { gapFromCode: true } : {}),
  }
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
