import type { MatchState } from '@/hooks/useMatchStream'
import {
  TIERS,
  type MatchStatus,
  type Requirement,
  type RequirementMatch,
  type Tier,
} from '@/lib/jobs/schema'
import { Evidence } from './Evidence'

const TIER_HEADING: Record<Tier, string> = {
  required: 'Required',
  preferred: 'Preferred',
  bonus: 'Bonus',
}

const STATUS_LABEL: Record<MatchStatus, string> = {
  met: 'Met',
  partial: 'Partly',
  missing: 'Not shown',
}

export function MatchResults({ state }: { state: MatchState }) {
  if (state.requirements.length === 0) return null
  const finished = state.phase === 'done' || state.phase === 'error'

  // The model often cites one strong bullet for many requirements. Show it in full
  // the first time, then point back to it, so the page doesn't repeat a paragraph six times.
  const firstCited = new Map<string, Requirement>()
  const repeatOf = new Map<number, Requirement>()
  for (const tier of TIERS) {
    for (const r of state.requirements.filter((x) => x.tier === tier)) {
      const m = state.matches[r.id]
      if (!m?.evidence || m.evidenceComputed || !m.evidenceFound) continue
      const key = m.evidence.toLowerCase().replace(/\s+/g, ' ').slice(0, 60)
      const first = firstCited.get(key)
      if (first) repeatOf.set(r.id, first)
      else firstCited.set(key, r)
    }
  }

  return (
    <div className="match-results">
      {state.report && <Headline state={state} />}
      {TIERS.map((tier) => {
        const inTier = state.requirements.filter((r) => r.tier === tier)
        if (inTier.length === 0) return null
        return (
          <section key={tier} aria-labelledby={`tier-${tier}`}>
            <h3 id={`tier-${tier}`}>
              {TIER_HEADING[tier]}
              {state.report && (
                <span className="tier-counts">{countsText(state.report.counts[tier])}</span>
              )}
            </h3>
            <ul className="requirements">
              {inTier.map((requirement) => (
                <RequirementRow
                  key={requirement.id}
                  requirement={requirement}
                  match={state.matches[requirement.id]}
                  finished={finished}
                  repeatOf={repeatOf.get(requirement.id)}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/** One plain sentence about the must-haves, since that's what decides a screen. */
function Headline({ state }: { state: MatchState }) {
  const required = state.report!.counts.required
  const total = required.met + required.partial + required.missing
  if (total === 0) return null
  return (
    <p className="match-headline">
      Your resume shows <strong>{required.met}</strong> of {total} required qualifications
      {required.partial > 0 && (
        <>
          , and part of <strong>{required.partial}</strong> more
        </>
      )}
      .
    </p>
  )
}

function RequirementRow({
  requirement,
  match,
  finished,
  repeatOf,
}: {
  requirement: Requirement
  match: RequirementMatch | undefined
  finished: boolean
  repeatOf?: Requirement
}) {
  const status = match?.status
  const className = [
    'requirement',
    status ? `requirement-${status}` : 'requirement-pending',
    status === 'missing' && requirement.tier === 'required' ? 'requirement-missing-required' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <li className={className}>
      <span className="requirement-status">
        {status ? (
          STATUS_LABEL[status]
        ) : finished ? (
          'Not checked'
        ) : (
          <span className="pending-dot" role="img" aria-label="Checking" />
        )}
      </span>
      <div className="requirement-body">
        <p className="requirement-text">{requirement.text}</p>
        {!requirement.foundInPosting && (
          <p className="requirement-note">
            Reworded from the posting; check it against the original.
          </p>
        )}
        {match?.evidenceComputed ? (
          <p className="requirement-computed">
            Calculated from the dates on your resume: {match.evidence}
          </p>
        ) : repeatOf ? (
          <p className="requirement-repeat">
            Same quote as for &ldquo;{shorten(repeatOf.text)}&rdquo; above.
          </p>
        ) : (
          match && <Evidence text={match.evidence} found={match.evidenceFound} />
        )}
        {match?.gap && <p className="requirement-gap">{match.gap}</p>}
      </div>
    </li>
  )
}

function countsText(counts: Record<MatchStatus, number>): string {
  const parts = [`${counts.met} met`]
  if (counts.partial > 0) parts.push(`${counts.partial} partly`)
  if (counts.missing > 0) parts.push(`${counts.missing} not shown`)
  return parts.join(', ')
}

function shorten(text: string, words = 8): string {
  const parts = text.split(/\s+/)
  return parts.length <= words ? text : `${parts.slice(0, words).join(' ')}…`
}
