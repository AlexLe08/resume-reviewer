'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { useBulletStream } from '@/hooks/useBulletStream';
import { useMatchStream } from '@/hooks/useMatchStream';
import { useReviewStream } from '@/hooks/useReviewStream';
import { useStoredState } from '@/hooks/useStoredState';
import { DEFAULT_STYLE, type WritingStyle } from '@/lib/bullets/request';
import { BulletWriterProvider } from './BulletWriter';
import { ChecksPanel } from './ChecksPanel';
import { FilePicker } from './FilePicker';
import { MatchPanel } from './MatchPanel';
import { ParsedTextPanel } from './ParsedTextPanel';
import { ReviewPanel } from './ReviewPanel';

type Mode = 'review' | 'match';

const STYLE_KEY = 'resume-reviewer:writing-style';

function isWritingStyle(value: unknown): value is WritingStyle {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.avoidText === 'string' && typeof v.preferText === 'string' && typeof v.noCodeSyntax === 'boolean';
}
const MODES: { id: Mode; label: string }[] = [
  { id: 'review', label: 'Recruiter review' },
  { id: 'match', label: 'Match to a job' },
];

export function ReviewWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>('review');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const review = useReviewStream();
  const match = useMatchStream();
  const bullets = useBulletStream();
  const [openBulletFor, setOpenBulletFor] = useState<number | null>(null);
  const [style, setStyle] = useStoredState<WritingStyle>(STYLE_KEY, DEFAULT_STYLE, isWritingStyle);

  const reviewBusy = review.state.status === 'extracting' || review.state.status === 'reviewing';
  const matchBusy = ['reading', 'extracting', 'matching'].includes(match.state.phase);
  const bulletBusy = bullets.state.phase === 'drafting' || bullets.state.phase === 'checking';
  // The local model handles one request at a time, so each action waits for the others.
  const busyElsewhere = (self: 'review' | 'match' | 'bullets') =>
    (self !== 'review' && reviewBusy) || (self !== 'match' && matchBusy) || (self !== 'bullets' && bulletBusy);

  const bulletWriter = {
    openId: openBulletFor,
    open: (id: number | null) => {
      if (id !== openBulletFor) bullets.reset();
      setOpenBulletFor(id);
    },
    state: bullets.state,
    run: bullets.run,
    cancel: bullets.cancel,
    blocked: busyElsewhere('bullets'),
    style,
    setStyle,
  };

  // Arrow keys move between tabs, as screen-reader users expect from a tab list.
  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const next = (index + (event.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length;
    setMode(MODES[next]!.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <main className="workspace">
      <header className="masthead">
        <h1>Resume Reviewer</h1>
        <p>
          See the text an applicant tracking system pulls from your resume, read it the way a recruiter
          would, and check it against a real job posting.
        </p>
      </header>

      <FilePicker file={file} onChange={setFile} disabled={reviewBusy || matchBusy} />

      <div role="tablist" aria-label="What to do with your resume" className="modes">
        {MODES.map((m, i) => (
          <button
            key={m.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${m.id}`}
            aria-selected={mode === m.id}
            aria-controls={`panel-${m.id}`}
            tabIndex={mode === m.id ? 0 : -1}
            className="mode-tab"
            onClick={() => setMode(m.id)}
            onKeyDown={(event) => handleTabKey(event, i)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Both panels stay mounted so switching tabs never loses a result. */}
      <section role="tabpanel" id="panel-review" aria-labelledby="tab-review" hidden={mode !== 'review'}>
        <div className="actions">
          {reviewBusy ? (
            <button type="button" className="button button-secondary" onClick={review.cancel}>
              Cancel review
            </button>
          ) : (
            <button
              type="button"
              className="button"
              disabled={!file || busyElsewhere('review')}
              onClick={() => file && review.start(file)}
            >
              Review resume
            </button>
          )}
          <p className="actions-hint">
            {busyElsewhere('review')
              ? 'Waiting for another request to finish: the local model handles one at a time.'
              : !file
                ? 'Choose your resume above first.'
                : ''}
          </p>
        </div>

        {review.state.status === 'extracting' && (
          <p className="pending" aria-live="polite">
            <span className="pending-dot" aria-hidden="true" />
            Reading the PDF
          </p>
        )}

        {review.state.error && !review.state.extracted && (
          <p role="alert" className="error-banner">
            {review.state.error}
          </p>
        )}

        {review.state.extracted && (
          <div className="results">
            <section className="column" aria-labelledby="parser-heading">
              <h2 id="parser-heading">What a parser sees</h2>
              <ChecksPanel checks={review.state.extracted.checks} />
              <ParsedTextPanel text={review.state.extracted.text} pageCount={review.state.extracted.pageCount} />
            </section>
            <section className="column" aria-labelledby="review-heading">
              <ReviewPanel state={review.state} />
            </section>
          </div>
        )}
      </section>

      <section role="tabpanel" id="panel-match" aria-labelledby="tab-match" hidden={mode !== 'match'}>
        <BulletWriterProvider value={bulletWriter}>
          <MatchPanel
            file={file}
            state={match.state}
            blocked={busyElsewhere('match')}
            onRun={(f, posting) => {
              bulletWriter.open(null);
              void match.run(f, posting);
            }}
            onCancel={match.cancel}
          />
        </BulletWriterProvider>
      </section>

      <p className="dev-note">
        Development build. With the default local model, your resume never leaves this computer. If the
        server is set to use Gemini&apos;s free tier, Google may use what you submit to improve its products.
      </p>
    </main>
  );
}
