'use client';

import { useId, useState, type DragEvent } from 'react';

interface FilePickerProps {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled: boolean;
}

/** The resume file, shared by both the review and the job match. */
export function FilePicker({ file, onChange, disabled }: FilePickerProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped && !disabled) onChange(dropped);
  }

  return (
    <div className="upload">
      <input
        id={inputId}
        type="file"
        accept="application/pdf,.pdf"
        className="visually-hidden"
        disabled={disabled}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
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
  );
}
