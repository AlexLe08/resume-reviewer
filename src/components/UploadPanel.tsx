'use client';

import { useId, useState, type DragEvent, type FormEvent } from 'react';

interface UploadPanelProps {
  busy: boolean;
  onSubmit: (file: File) => void;
  onCancel: () => void;
}

export function UploadPanel({ busy, onSubmit, onCancel }: UploadPanelProps) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file) onSubmit(file);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped && !busy) setFile(dropped);
  }

  return (
    <form className="upload" onSubmit={handleSubmit}>
      <input
        id={inputId}
        type="file"
        accept="application/pdf,.pdf"
        className="visually-hidden"
        disabled={busy}
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
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
        <span className="dropzone-title">{file ? file.name : 'Choose a PDF, or drop it here'}</span>
        <span className="dropzone-hint">PDF up to 5 MB. Nothing is saved after the review.</span>
      </label>

      {busy ? (
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Cancel review
        </button>
      ) : (
        <button type="submit" className="button" disabled={!file}>
          Review resume
        </button>
      )}
    </form>
  );
}
