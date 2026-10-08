'use client';

import { useReviewStream } from '@/hooks/useReviewStream';
import { ChecksPanel } from './ChecksPanel';
import { ParsedTextPanel } from './ParsedTextPanel';
import { ReviewPanel } from './ReviewPanel';
import { UploadPanel } from './UploadPanel';

export function ReviewWorkspace() {
  const { state, start, cancel } = useReviewStream();
  const busy = state.status === 'extracting' || state.status === 'reviewing';

  return (
    <main className="workspace">
      <header className="masthead">
        <h1>Resume Reviewer</h1>
        <p>
          See the text an applicant tracking system pulls from your resume, then read it the way a
          recruiter would.
        </p>
      </header>

      <UploadPanel busy={busy} onSubmit={start} onCancel={cancel} />

      <p className="dev-note">
        Development build: reviews use Google&apos;s Gemini free tier, which may use submitted
        content to improve Google&apos;s products. Test with your own resume or a sample.
      </p>

      {state.status === 'extracting' && (
        <p className="pending" aria-live="polite">
          <span className="pending-dot" aria-hidden="true" />
          Reading the PDF
        </p>
      )}

      {state.error && !state.extracted && (
        <p role="alert" className="error-banner">
          {state.error}
        </p>
      )}

      {state.extracted && (
        <div className="results">
          <section className="column" aria-labelledby="parser-heading">
            <h2 id="parser-heading">What a parser sees</h2>
            <ChecksPanel checks={state.extracted.checks} />
            <ParsedTextPanel text={state.extracted.text} pageCount={state.extracted.pageCount} />
          </section>
          <section className="column" aria-labelledby="review-heading">
            <ReviewPanel state={state} />
          </section>
        </div>
      )}
    </main>
  );
}
