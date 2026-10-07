interface ParsedTextPanelProps {
  text: string;
  pageCount: number;
}

export function ParsedTextPanel({ text, pageCount }: ParsedTextPanelProps) {
  return (
    <div className="parsed">
      <p className="parsed-intro">
        This is the plain text software pulled from your PDF ({pageCount}{' '}
        {pageCount === 1 ? 'page' : 'pages'}, {text.length.toLocaleString()} characters). If it is out
        of order or missing pieces here, an applicant tracking system likely sees it the same way.
      </p>
      {/* tabIndex lets keyboard users scroll the box. */}
      <pre className="parsed-text" tabIndex={0} aria-label="Text extracted from your resume">
        {text || 'No text found.'}
      </pre>
    </div>
  );
}
