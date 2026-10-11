'use client';

import { useId, useState } from 'react';
import type { MatchState } from '@/hooks/useMatchStream';
import { MatchResults } from './MatchResults';

const MIN_POSTING_CHARS = 100;
const MAX_POSTING_CHARS = 20_000;

interface MatchPanelProps {
  file: File | null;
  state: MatchState;
  /** Another request is running; the local model handles one at a time. */
  blocked: boolean;
  onRun: (file: File, posting: string) => void;
  onCancel: () => void;
}

export function MatchPanel({ file, state, blocked, onRun, onCancel }: MatchPanelProps) {
  const textareaId = useId();
  const hintId = useId();
  const [posting, setPosting] = useState('');
  const busy = state.phase === 'reading' || state.phase === 'extracting' || state.phase === 'matching';
  const length = posting.trim().length;
  const canRun = file !== null && length >= MIN_POSTING_CHARS && posting.length <= MAX_POSTING_CHARS && !blocked;

  return (
    <div className="match">
      <label htmlFor={textareaId} className="field-label">
        Job posting
      </label>
      <p id={hintId} className="field-hint">
        Paste the whole posting. The requirements are picked out for you; benefits and company text are ignored.
      </p>
      <textarea
        id={textareaId}
        className="posting-input"
        aria-describedby={hintId}
        rows={10}
        value={posting}
        disabled={busy}
        onChange={(event) => setPosting(event.target.value)}
      />

      <div className="actions">
        {busy ? (
          <button type="button" className="button button-secondary" onClick={onCancel}>
            Cancel match
          </button>
        ) : (
          <button type="button" className="button" disabled={!canRun} onClick={() => file && onRun(file, posting)}>
            Match to this job
          </button>
        )}
        <p className="actions-hint">{disabledReason(file, length, posting.length, blocked, busy)}</p>
      </div>

      <Progress state={state} />

      {state.phase === 'error' && state.error && (
        <p role="alert" className="error-banner">
          {state.error}
        </p>
      )}

      <MatchResults state={state} />
    </div>
  );
}

function disabledReason(file: File | null, length: number, rawLength: number, blocked: boolean, busy: boolean): string {
  if (busy) return 'With a local model this usually takes 3 to 5 minutes. Results appear as each one is checked.';
  if (blocked) return 'Waiting for the review to finish: the local model handles one request at a time.';
  if (!file) return 'Choose your resume above first.';
  if (rawLength > MAX_POSTING_CHARS) return 'That posting is over 20,000 characters. Paste just the job description.';
  if (length > 0 && length < MIN_POSTING_CHARS) return 'Paste the full posting, including its requirements.';
  return '';
}

function Progress({ state }: { state: MatchState }) {
  let text: string | null = null;
  if (state.phase === 'reading') text = 'Reading your resume';
  if (state.phase === 'extracting') {
    const n = state.requirements.length;
    text = n === 0 ? 'Finding the requirements in the posting' : `Finding the requirements in the posting (${n} so far)`;
  }
  if (state.phase === 'matching') {
    const done = Object.keys(state.matches).length;
    text = `Checking your resume against each requirement (${done} of ${state.requirements.length})`;
  }
  if (!text) return null;
  return (
    <p className="pending" aria-live="polite">
      <span className="pending-dot" aria-hidden="true" />
      {text}
    </p>
  );
}
