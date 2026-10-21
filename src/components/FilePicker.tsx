'use client';

import { useId, useState, type DragEvent } from 'react';
import { isTooLarge, TOO_LARGE_MESSAGE } from '@/lib/http/upload-limits';

interface FilePickerProps {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled: boolean;
}

/** The resume file, shared by both the review and the job match. */
export function FilePicker({ file, onChange, disabled }: FilePickerProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A too-large file is refused here: the host rejects the request before our server can explain why.
  // Refusing keeps whatever file was chosen before.
  function choose(next: File | null) {
    if (next && isTooLarge(next.size)) {
      setError(TOO_LARGE_MESSAGE);
      return;
    }
    setError(null);
    onChange(next);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped && !disabled) choose(dropped);
  }

  return (
    <>
      <div className="upload">
        <input
          id={inputId}
          type="file"
          accept="application/pdf,.pdf"
          className="visually-hidden"
          disabled={disabled}
          onChange={(event) => {
            choose(event.target.files?.[0] ?? null);
            // Let the same file be chosen again after it was refused.
            event.target.value = '';
          }}
        />
        <label
          htmlFor={inputId}
          className={dragging ? 'dropzone is-dragging' : 'dropzone'}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <span className="dropzone-title">{file ? file.name : 'Choose your resume (PDF), or drop it here'}</span>
          <span className="dropzone-hint">PDF up to 4 MB. Nothing is saved after the review.</span>
        </label>
      </div>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
    </>
  );
}
