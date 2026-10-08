import { hasUsableText, runChecks } from '@/lib/checks';
import { getEnv } from '@/lib/env';
import { extractPdfText, looksLikePdf, type ExtractedDocument } from '@/lib/pdf/extract';
import { PERSONAS, type Persona } from '@/lib/review/personas';
import { runReview } from '@/lib/review/run';
import { encodeEvent, type StreamEvent } from '@/lib/stream/events';

// pdf.js needs Node APIs, so this route can't run on the edge runtime.
export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

type Send = (event: StreamEvent) => void;

/**
 * POST /api/review
 *
 * Validation failures return a normal JSON error with a 4xx/5xx status.
 * Once the input is valid, we switch to a streamed NDJSON response:
 * extracted → review_started → review_delta* → review_done (or error).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    getEnv();
  } catch (err) {
    console.error('config_error', err instanceof Error ? err.message : err);
    return jsonError(500, 'The server configuration is invalid. Check the terminal and .env.example.');
  }

  const upload = await readUpload(request);
  if (upload instanceof Response) return upload;

  const doc = await tryExtract(upload);
  if (doc instanceof Response) return doc;

  const checks = runChecks(doc);
  const persona = PERSONAS.recruiter;

  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send: Send = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          closed = true; // The client went away.
        }
      };

      try {
        send({ type: 'extracted', pageCount: doc.pageCount, text: doc.text, checks });

        if (!hasUsableText(doc)) {
          send({
            type: 'error',
            stage: 'extract',
            message:
              "This PDF has almost no selectable text, so there's nothing to review. Export it again from your editor as a text PDF.",
            retryable: false,
          });
          return;
        }

        await streamReview(doc, persona, send, request.signal);
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}

/** Adapts the shared review pipeline to our streaming event protocol. */
async function streamReview(
  doc: ExtractedDocument,
  persona: Persona,
  send: Send,
  signal: AbortSignal,
): Promise<void> {
  send({ type: 'review_started', personaId: persona.id, personaName: persona.name });

  const outcome = await runReview(doc, persona, {
    signal,
    onDelta: (text) => send({ type: 'review_delta', text }),
  });

  if (outcome.ok) {
    send({ type: 'review_done', personaId: persona.id, review: outcome.review, call: outcome.call });
    return;
  }
  if (outcome.kind === 'aborted') return;

  send({
    type: 'error',
    stage: 'review',
    message: outcome.message,
    retryable: outcome.kind === 'llm_error' ? outcome.retryable : true,
  });
}

async function readUpload(request: Request): Promise<Uint8Array | Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, 'Send the resume as multipart form data.');
  }

  const file = form.get('resume');
  if (!(file instanceof File)) return jsonError(400, 'Attach a PDF in the "resume" field.');
  if (file.size === 0) return jsonError(400, 'That file is empty.');
  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonError(413, 'That file is over 5 MB. Export a smaller PDF and try again.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) return jsonError(415, 'Only PDF files are supported right now.');
  return bytes;
}

async function tryExtract(bytes: Uint8Array): Promise<ExtractedDocument | Response> {
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

function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}
