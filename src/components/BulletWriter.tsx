'use client';

import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import type { BulletState, CandidateView } from '@/hooks/useBulletStream';
import type { CheckResult } from '@/lib/bullets/checks';
import { editIssues, type EditContext } from '@/lib/bullets/edit-issues';
import { parseNoteGroups, parseStyle, type BulletRequest, type WritingStyle } from '@/lib/bullets/request';

const MAX_WORDS = 30;

interface BulletWriterValue {
  /** The requirement whose panel is open, if any. Only one at a time. */
  openId: number | null;
  open: (id: number | null) => void;
  state: BulletState;
  run: (task: BulletRequest) => void;
  cancel: () => void;
  /** Another request is running; the local model handles one at a time. */
  blocked: boolean;
  style: WritingStyle;
  setStyle: (style: WritingStyle) => void;
}

const BulletWriterContext = createContext<BulletWriterValue | null>(null);

export function BulletWriterProvider({ value, children }: { value: BulletWriterValue; children: ReactNode }) {
  return <BulletWriterContext.Provider value={value}>{children}</BulletWriterContext.Provider>;
}

export function useBulletWriter(): BulletWriterValue {
  const value = useContext(BulletWriterContext);
  if (!value) throw new Error('useBulletWriter must be used inside BulletWriterProvider');
  return value;
}

/** Why a draft is being revised, in the person's terms. */
const REVISION_REASON: Record<CheckResult['id'], string> = {
  empty: 'the draft was empty',
  numbers: 'it added a number your notes don’t have',
  terms: 'it named something your notes don’t mention',
  length: 'it was too long',
  first_person: 'it used first person',
  style: 'it broke one of your style rules',
  claims: 'a reviewer found a claim your notes don’t support',
};

/** Write candidate bullets for one job requirement, from the person's own notes. */
export function BulletPanel({ target, id }: { target: string; id: string }) {
  const writer = useBulletWriter();
  const [bullet, setBullet] = useState('');
  const [role, setRole] = useState('');
  const [notes, setNotes] = useState('');
  // The exact inputs of the last run: edits are checked against what the candidates were written from.
  const [lastRun, setLastRun] = useState<EditContext | null>(null);

  const { state } = writer;
  const busy = state.phase === 'drafting' || state.phase === 'checking';
  const noteGroups = parseNoteGroups(notes);
  const noteLines = noteGroups.flat();
  const canRun = !busy && !writer.blocked && (bullet.trim() !== '' || noteLines.length > 0);

  function run() {
    const style = parseStyle(writer.style);
    setLastRun({ bullet: bullet.trim(), notes: noteLines, maxWords: MAX_WORDS, avoid: style.avoid, noCodeSyntax: style.noCodeSyntax });
    writer.run({ role: role.trim() || undefined, bullet: bullet.trim(), target, noteGroups, maxWords: MAX_WORDS, ...style });
  }

  // Keep each candidate's position as its key: angles are written by the model and can repeat.
  const indexed = state.candidates.map((candidate, index) => ({ candidate, index }));
  const passed = indexed.filter(({ candidate }) => candidate.status === 'passed');
  const failed = indexed.filter(({ candidate }) => candidate.status === 'failed');
  const inProgress = indexed.filter(({ candidate }) => candidate.status === 'checking' || candidate.status === 'revising');

  return (
    <div className="bullet-panel" id={id}>
      <p className="bullet-panel-intro">
        Write about what you actually did. Candidates use only your notes and your existing bullet: anything
        else is caught and removed before you see it.
      </p>

      <Field
        label="Your notes"
        hint="One true fact per line, and a blank line between unrelated pieces of work: facts in different groups never end up linked in one bullet. Every fact here can end up on your resume, so leave out guesses."
      >
        {(fieldId, hintId) => (
          <textarea id={fieldId} aria-describedby={hintId} className="text-input" rows={8} value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} />
        )}
      </Field>

      <Field label="Existing bullet to improve (optional)" hint="Leave empty to write a new bullet from your notes.">
        {(fieldId, hintId) => (
          <textarea id={fieldId} aria-describedby={hintId} className="text-input" rows={2} value={bullet} disabled={busy} onChange={(e) => setBullet(e.target.value)} />
        )}
      </Field>

      <Field label="Role (optional)" hint="Context only, for example “Software Engineer II, search team”. It isn't repeated in the bullet.">
        {(fieldId, hintId) => (
          <input id={fieldId} aria-describedby={hintId} className="text-input" value={role} disabled={busy} onChange={(e) => setRole(e.target.value)} />
        )}
      </Field>

      <StyleSettings disabled={busy} />

      <div className="actions">
        {busy ? (
          <button type="button" className="button button-secondary" onClick={writer.cancel}>
            Cancel
          </button>
        ) : (
          <button type="button" className="button" disabled={!canRun} onClick={run}>
            Write candidates
          </button>
        )}
        <p className="actions-hint">
          {busy
            ? 'With a local model this takes 2 to 5 minutes. Each candidate appears once it passes every check.'
            : writer.blocked
              ? 'Waiting for another request to finish: the local model handles one at a time.'
              : !canRun
                ? 'Add at least one note.'
                : ''}
        </p>
      </div>

      {state.phase === 'drafting' && (
        <p className="pending" aria-live="polite">
          <span className="pending-dot" aria-hidden="true" />
          Drafting candidates from different angles
        </p>
      )}

      {inProgress.length > 0 && (
        <ul className="candidates-pending" aria-live="polite">
          {inProgress.map(({ candidate: c, index }) => (
            <li key={index}>
              <span className="pending-dot" aria-hidden="true" />
              <strong>{c.angle}</strong>:{' '}
              {c.status === 'revising' && c.failing[0] ? `revising, because ${REVISION_REASON[c.failing[0]]}` : 'checking'}
            </li>
          ))}
        </ul>
      )}

      {state.phase === 'error' && state.error && (
        <p role="alert" className="error-banner">
          {state.error}
        </p>
      )}

      {passed.length > 0 && lastRun && (
        <section aria-label="Candidates" className="candidates">
          <p className="candidates-intro">
            {passed.length === 1 ? 'One candidate passed every check.' : `${passed.length} candidates passed every check.`} Pick one, or
            two that cover different things. Edit freely; edits are checked against your notes too.
          </p>
          <p className="field-hint">
            The checks make sure every fact comes from your notes. They can&apos;t fully check how facts are linked, so
            read each one for that: did this really cause, enable, or improve that?
          </p>
          {passed.map(({ candidate, index }) => (
            <CandidateCard key={index} candidate={candidate} context={lastRun} />
          ))}
        </section>
      )}

      {state.phase === 'done' && failed.length > 0 && (
        <p className="field-hint">
          {failed.length === 1 ? 'One candidate' : `${failed.length} candidates`} didn&apos;t pass the checks and
          {failed.length === 1 ? ' isn’t' : ' aren’t'} shown.
        </p>
      )}

      {state.questions.length > 0 && state.phase !== 'drafting' && (
        <section aria-label="Questions" className="bullet-questions">
          <p className="field-label">Facts that would make these stronger</p>
          <ul>
            {state.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          <p className="field-hint">If you know an answer for certain, add it to your notes as a fact and write again.</p>
        </section>
      )}
    </div>
  );
}

function CandidateCard({ candidate, context }: { candidate: CandidateView; context: EditContext }) {
  const textId = useId();
  const [text, setText] = useState(candidate.draft);
  const [copied, setCopied] = useState(false);
  useEffect(() => setText(candidate.draft), [candidate.draft]);

  const edited = text.trim() !== candidate.draft;
  const issues = edited ? editIssues(text, context) : [];

  async function copy() {
    try {
      await navigator.clipboard.writeText(text.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the text is still selectable in the box.
    }
  }

  return (
    <div className="candidate">
      <label htmlFor={textId} className="candidate-angle">
        {candidate.angle}
      </label>
      <textarea id={textId} className="text-input candidate-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      {issues.length > 0 && (
        <ul className="candidate-issues" aria-live="polite">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      <div className="candidate-actions">
        <button type="button" className="button button-secondary" onClick={copy}>
          Copy
        </button>
        {edited && (
          <button type="button" className="link-button" onClick={() => setText(candidate.draft)}>
            Undo edits
          </button>
        )}
        <span className="field-hint" aria-live="polite">
          {copied ? 'Copied' : ''}
        </span>
      </div>
    </div>
  );
}

function StyleSettings({ disabled }: { disabled: boolean }) {
  const { style, setStyle } = useBulletWriter();
  return (
    <details className="style-settings">
      <summary>Your writing style</summary>
      <p className="field-hint">Saved in this browser and applied to every bullet. Enforced by code, so it holds every time.</p>
      <Field label="Words you don't use" hint="Comma-separated, for example: seamless, verticals, diverse">
        {(fieldId, hintId) => (
          <input
            id={fieldId}
            aria-describedby={hintId}
            className="text-input"
            value={style.avoidText}
            disabled={disabled}
            onChange={(e) => setStyle({ ...style, avoidText: e.target.value })}
          />
        )}
      </Field>
      <Field label="Replacements" hint="One per line, for example: verticals -> internal partners">
        {(fieldId, hintId) => (
          <textarea
            id={fieldId}
            aria-describedby={hintId}
            className="text-input"
            rows={2}
            value={style.preferText}
            disabled={disabled}
            onChange={(e) => setStyle({ ...style, preferText: e.target.value })}
          />
        )}
      </Field>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={style.noCodeSyntax}
          disabled={disabled}
          onChange={(e) => setStyle({ ...style, noCodeSyntax: e.target.checked })}
        />
        Keep code syntax out of bullets (attribute names, role=…, HTML tags). Save those for the interview.
      </label>
    </details>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: (fieldId: string, hintId: string) => ReactNode }) {
  const fieldId = useId();
  const hintId = useId();
  return (
    <div className="field">
      <label htmlFor={fieldId} className="field-label">
        {label}
      </label>
      <p id={hintId} className="field-hint">
        {hint}
      </p>
      {children(fieldId, hintId)}
    </div>
  );
}
