export interface ExtractedDocument {
  text: string;
  pageCount: number;
}

// Every PDF starts with the bytes "%PDF". Checking them is cheap and stops us
// trusting the browser-supplied MIME type, which the client controls.
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

export function looksLikePdf(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, i) => bytes[i] === byte);
}

/**
 * Pulls the plain text out of a PDF, roughly the way a basic ATS parser would.
 *
 * Phase 1 only needs the text. Later we'll want each text item's position on
 * the page (pdf.js exposes it via page.getTextContent()) to detect multi-column
 * layouts. That change stays inside this file.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedDocument> {
  // Loaded on demand: unpdf is an ES module, and the eval script runs as
  // CommonJS. A dynamic import works in both, and costs nothing in Next.js.
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { text: normalizeWhitespace(text), pageCount: totalPages };
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
