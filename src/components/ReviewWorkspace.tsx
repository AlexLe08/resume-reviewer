'use client';

import { useState } from 'react';
import { useBulletStream } from '@/hooks/useBulletStream';
import { useMatchStream } from '@/hooks/useMatchStream';
import { useReviewStream } from '@/hooks/useReviewStream';
import { useStoredState } from '@/hooks/useStoredState';
import { DEFAULT_STYLE, isWritingStyle, type WritingStyle } from '@/lib/bullets/request';
import { BulletWriterProvider } from './BulletWriter';
import { ChecksPanel } from './ChecksPanel';
import { DemoBanner } from './DemoBanner';
import { FilePicker } from './FilePicker';
import { MatchPanel } from './MatchPanel';
import { ParsedTextPanel } from './ParsedTextPanel';
import { ProofreadPanel } from './ProofreadPanel';
import { ReviewPanel } from './ReviewPanel';
import { SamplePicker } from './SamplePicker';
import { Tabs } from './Tabs';

type Mode = 'review' | 'match';

const STYLE_KEY = 'resume-reviewer:writing-style';

const MODES: { id: Mode; label: string }[] = [
  { id: 'review', label: 'Recruiter review' },
  { id: 'match', label: 'Match to a job' },
];

/**
 * `demo` is the hosted build with no model behind it: reviews are replayed from
 * recordings, and only the sample resumes have any.
 */
export function ReviewWorkspace({ demo = false }: { demo?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  // Demo only: a sample resume chosen instead of a file, and whether the last review used one.
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [ranSample, setRanSample] = useState(false);
  const [mode, setMode] = useState<Mode>('review');

  const review = useReviewStream();
  // Which reviewer's tab is open; null means the first, so each new review starts on it.
  const [reviewerTab, setReviewerTab] = useState<string | null>(null);
  const reviewers = review.state.reviewers;
  const openReviewer = reviewerTab !== null && reviewers.some((r) => r.id === reviewerTab) ? reviewerTab : reviewers[0]?.id;
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

  return (
    <main className="workspace">
      <header className="masthead">
        <h1>Resume Reviewer</h1>
        <p>
          See the text an applicant tracking system pulls from your resume, read it the way a recruiter
          would, and check it against a real job posting.
        </p>
      </header>

      {demo && (
        <SamplePicker
          selected={sampleId}
          onSelect={(id) => {
            setSampleId(id);
            setFile(null);
          }}
          disabled={reviewBusy}
        />
      )}

      <FilePicker
        file={file}
        onChange={(next) => {
          setFile(next);
          if (next) setSampleId(null);
        }}
        disabled={reviewBusy || matchBusy}
      />

      <Tabs label="What to do with your resume" tabs={MODES} selected={mode} onSelect={setMode} />

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
              disabled={(!file && !sampleId) || busyElsewhere('review')}
              onClick={() => {
                const input = sampleId ? { sample: sampleId } : file;
                if (!input) return;
                setReviewerTab(null);
                setRanSample(sampleId !== null);
                void review.start(input);
              }}
            >
              Review resume
            </button>
          )}
          <p className="actions-hint">
            {busyElsewhere('review')
              ? 'Waiting for another request to finish: the local model handles one at a time.'
              : !file && !sampleId
                ? demo
                  ? 'Choose a sample or your resume above first.'
                  : 'Choose your resume above first.'
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

        {demo && ranSample && review.state.extracted && (
          <DemoBanner model={reviewers.find((r) => r.call)?.call?.model} />
        )}

        {review.state.extracted && (
          <div className="results">
            <section className="column" aria-labelledby="parser-heading">
              <h2 id="parser-heading">What a parser sees</h2>
              <ChecksPanel checks={review.state.extracted.checks} />
              <ParsedTextPanel text={review.state.extracted.text} pageCount={review.state.extracted.pageCount} />
            </section>
            <section className="column" aria-label="Reviews">
              <Tabs
                label="Reviewers"
                tabs={reviewers.map((r) => ({ id: r.id, label: r.name, status: r.status }))}
                selected={openReviewer ?? ''}
                onSelect={setReviewerTab}
              />
              {reviewers.map((r) => (
                <div key={r.id} role="tabpanel" id={`panel-${r.id}`} aria-labelledby={`tab-${r.id}`} hidden={r.id !== openReviewer}>
                  {r.kind === 'proofread' ? <ProofreadPanel reviewer={r} /> : <ReviewPanel reviewer={r} />}
                </div>
              ))}
            </section>
          </div>
        )}
      </section>

      <section role="tabpanel" id="panel-match" aria-labelledby="tab-match" hidden={mode !== 'match'}>
        {demo ? (
          <p className="demo-note">
            Job matching and the bullet writer aren&apos;t in the demo yet. Run the app locally to use them.
          </p>
        ) : (
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
        )}
      </section>

      <p className="dev-note">
        {demo
          ? 'Demo: an uploaded PDF is read on the server for the parser view and checks, and is not stored. No model ever sees it.'
          : "Development build. With the default local model, your resume never leaves this computer. If the server is set to use Gemini's free tier, Google may use what you submit to improve its products."}
      </p>
    </main>
  );
}
