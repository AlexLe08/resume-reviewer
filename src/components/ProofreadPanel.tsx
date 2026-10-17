import type { ReviewerState } from '@/hooks/useReviewStream';
import { Evidence } from './Evidence';
import { UsageList } from './UsageList';

const KIND_TEXT = {
  nonword: 'Misspelling',
  realword: 'Wrong word',
  'tech-casing': 'Capitalization',
  other: 'Other',
} as const;

export function ProofreadPanel({ reviewer }: { reviewer: ReviewerState }) {
  const { findings, call } = reviewer;

  return (
    <div className="review">
      <h2 id={`${reviewer.id}-heading`}>Spelling and capitalization</h2>

      {reviewer.status === 'waiting' && (
        <p className="pending" aria-live="polite">
          Waiting for the earlier reviewers to finish
        </p>
      )}

      {reviewer.status === 'running' && (
        <p className="pending" aria-live="polite">
          <span className="pending-dot" aria-hidden="true" />
          Checking every word
          {reviewer.liveChars > 0 && ` (${reviewer.liveChars.toLocaleString()} characters written)`}
        </p>
      )}

      {reviewer.status === 'error' && !findings && (
        <p role="alert" className="error-banner">
          {reviewer.error}
        </p>
      )}

      {findings && findings.length === 0 && <p className="summary">No spelling or capitalization mistakes found.</p>}

      {findings && findings.length > 0 && (
        <ul className="findings">
          {findings.map((finding, i) => (
            <li key={i} className="finding">
              <p className="finding-title">
                <span className="severity-tag">{KIND_TEXT[finding.kind]}</span> {finding.word} → {finding.suggestion}
              </p>
              <Evidence text={finding.quote} found={finding.evidenceFound} />
            </li>
          ))}
        </ul>
      )}

      {findings && (
        <p className="finding-suggestion">
          Only mistakes the proofreader is sure about are listed. Names and technology terms are left alone, so
          read the resume once yourself too.
        </p>
      )}

      {call && <UsageList call={call} />}
    </div>
  );
}
