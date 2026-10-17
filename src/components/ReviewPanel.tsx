import type { ReviewerState } from '@/hooks/useReviewStream';
import type { GroundedReview } from '@/lib/review/grounding';
import type { Review } from '@/lib/review/schema';
import { Evidence } from './Evidence';

const VERDICT_TEXT: Record<Review['wouldAdvance'], string> = {
  yes: 'Would move forward',
  maybe: 'On the fence',
  no: 'Would not move forward',
};

const SEVERITY_ORDER: Record<Review['issues'][number]['severity'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function ReviewPanel({ reviewer }: { reviewer: ReviewerState }) {
  const { review, call } = reviewer;

  return (
    <div className="review">
      <h2 id="review-heading">{reviewer.name}&apos;s read</h2>

      {reviewer.status === 'waiting' && (
        <p className="pending" aria-live="polite">
          Waiting for the earlier reviewers to finish
        </p>
      )}

      {reviewer.status === 'running' && (
        <p className="pending" aria-live="polite">
          <span className="pending-dot" aria-hidden="true" />
          Reading your resume
          {reviewer.liveChars > 0 && ` (${reviewer.liveChars.toLocaleString()} characters written)`}
        </p>
      )}

      {reviewer.status === 'error' && !review && (
        <p role="alert" className="error-banner">
          {reviewer.error}
        </p>
      )}

      {review && <ReviewBody review={review} />}

      {call && (
        <dl className="usage">
          <div>
            <dt>Model</dt>
            <dd>
              {call.provider} / {call.model}
            </dd>
          </div>
          <div>
            <dt>Tokens in / out / thinking</dt>
            <dd>
              {call.inputTokens.toLocaleString()} / {call.outputTokens.toLocaleString()} /{' '}
              {call.thinkingTokens.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{(call.latencyMs / 1000).toFixed(1)} s</dd>
          </div>
          {review && review.grounding.quotes > 0 && (
            <div>
              <dt>Quotes found in resume</dt>
              <dd>
                {review.grounding.found} of {review.grounding.quotes}
              </dd>
            </div>
          )}
          {call.estimatedCostUsd > 0 && (
            <div>
              <dt>Estimated cost</dt>
              <dd>${call.estimatedCostUsd.toFixed(4)}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

function ReviewBody({ review }: { review: GroundedReview }) {
  const issues = [...review.issues].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  return (
    <>
      <p className={`verdict verdict-${review.wouldAdvance}`}>{VERDICT_TEXT[review.wouldAdvance]}</p>
      <p className="summary">{review.summary}</p>

      {issues.length > 0 && (
        <section aria-labelledby="issues-heading">
          <h3 id="issues-heading">What to fix</h3>
          <ul className="findings">
            {issues.map((issue, i) => (
              <li key={i} className={`finding severity-${issue.severity}`}>
                <p className="finding-title">
                  <span className="severity-tag">{issue.severity}</span> {issue.problem}
                </p>
                <Evidence text={issue.evidence} found={issue.evidenceFound} />
                <p className="finding-suggestion">{issue.suggestion}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.strengths.length > 0 && (
        <section aria-labelledby="strengths-heading">
          <h3 id="strengths-heading">What works</h3>
          <ul className="findings">
            {review.strengths.map((strength, i) => (
              <li key={i} className="finding">
                <p className="finding-title">{strength.point}</p>
                <Evidence text={strength.evidence} found={strength.evidenceFound} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
