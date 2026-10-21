import { extractPdfText, looksLikePdf, type ExtractedDocument } from '@/lib/pdf/extract';
import { isTooLarge, TOO_LARGE_MESSAGE } from './upload-limits';

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export async function readForm(request: Request): Promise<FormData | Response> {
  try {
    return await request.formData();
  } catch {
    return jsonError(400, 'Send the request as multipart form data.');
  }
}

/** The uploaded resume's bytes, after checking size and that it really is a PDF. */
export async function readResumeFile(form: FormData): Promise<Uint8Array | Response> {
  const file = form.get('resume');
  if (!(file instanceof File)) return jsonError(400, 'Attach a PDF in the "resume" field.');
  if (file.size === 0) return jsonError(400, 'That file is empty.');
  // The browser checks this too; this is the check that can't be skipped.
  if (isTooLarge(file.size)) return jsonError(413, TOO_LARGE_MESSAGE);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) return jsonError(415, 'Only PDF files are supported right now.');
  return bytes;
}

export async function extractResume(bytes: Uint8Array): Promise<ExtractedDocument | Response> {
  try {
    return await extractPdfText(bytes);
  } catch (err) {
    console.error('pdf_extract_failed', err instanceof Error ? err.message : err);
    return jsonError(
      422,
      "This PDF couldn't be read. If it's password-protected, remove the password and try again.",
    );
  }
}
