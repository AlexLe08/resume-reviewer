import type { ReviewState } from '@/hooks/useReviewStream';
import type { Review } from '@/lib/review/schema';

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

export function ReviewPanel({ state }: { state: ReviewState }) {
  const name = state.persona?.name ?? 'Recruiter';

  return (
    <div className="review">
      <h2 id="review-heading">{name}&apos;s read</h2>

      {state.status === 'reviewing' && (
        <p className="pending" aria-live="polite">
          <span className="pending-dot" aria-hidden="true" />
          Reading your resume
          {state.liveChars > 0 && ` (${state.liveChars.toLocaleString()} characters written)`}
        </p>
      )}

      {state.review && <ReviewBody review={state.review} />}

      {state.call && (
        <dl className="usage">
          <div>
            <dt>Model</dt>
            <dd>{state.call.model}</dd>
          </div>
          <div>
            <dt>Tokens in / out / thinking</dt>
            <dd>
              {state.call.inputTokens.toLocaleString()} / {state.call.outputTokens.toLocaleString()} /{' '}
              {state.call.thinkingTokens.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{(state.call.latencyMs / 1000).toFixed(1)} s</dd>
          </div>
          {state.call.estimatedCostUsd > 0 && (
            <div>
              <dt>Estimated cost</dt>
              <dd>${state.call.estimatedCostUsd.toFixed(4)}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

function ReviewBody({ review }: { review: Review }) {
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
                {issue.evidence && <Evidence text={issue.evidence} />}
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
                <Evidence text={strength.evidence} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Evidence({ text }: { text: string }) {
  return (
    <blockquote className="evidence">
      <mark>{text}</mark>
    </blockquote>
  );
}
