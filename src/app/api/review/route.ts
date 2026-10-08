import { hasUsableText, runChecks } from '@/lib/checks';
import { getEnv } from '@/lib/env';
import {
  currentPrices,
  describeLlmError,
  modelName,
  providerName,
  streamStructured,
  type TokenUsage,
} from '@/lib/llm';
import { estimateCostUsd, logCall, type CallRecord } from '@/lib/llm/usage';
import { extractPdfText, looksLikePdf, type ExtractedDocument } from '@/lib/pdf/extract';
import { annotateGrounding } from '@/lib/review/grounding';
import { PERSONAS, type Persona } from '@/lib/review/personas';
import { buildReviewPrompt } from '@/lib/review/prompt';
import { parseReview, reviewJsonSchema } from '@/lib/review/schema';
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

        await runReview(doc, persona, send, request.signal);
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

async function runReview(
  doc: ExtractedDocument,
  persona: Persona,
  send: Send,
  signal: AbortSignal,
): Promise<void> {
  send({ type: 'review_started', personaId: persona.id, personaName: persona.name });

  const { system, user } = buildReviewPrompt(persona, doc.text);
  const started = performance.now();
  let raw = '';
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
  let servedModel: string | undefined;

  try {
    const chunks = streamStructured({
      system,
      user,
      jsonSchema: reviewJsonSchema(),
      temperature: 0.4,
      signal,
    });
    for await (const chunk of chunks) {
      if (chunk.text) {
        raw += chunk.text;
        send({ type: 'review_delta', text: chunk.text });
      }
      if (chunk.usage) usage = chunk.usage;
      if (chunk.model) servedModel = chunk.model;
    }
  } catch (err) {
    if (signal.aborted) return;
    console.error('llm_call_failed', err instanceof Error ? err.message : err);
    send({ type: 'error', stage: 'review', ...describeLlmError(err) });
    return;
  }

  const call: CallRecord = {
    provider: providerName(),
    model: servedModel ?? modelName(),
    personaId: persona.id,
    latencyMs: Math.round(performance.now() - started),
    ...usage,
    estimatedCostUsd: estimateCostUsd(usage, currentPrices()),
  };
  // Log before validating, so failed calls still show up in usage numbers.
  logCall(call);

  const parsed = parseReview(raw);
  if (!parsed.success) {
    console.error('review_validation_failed', parsed.reason);
    send({
      type: 'error',
      stage: 'review',
      message: 'The reviewer returned an incomplete result. Try again.',
      retryable: true,
    });
    return;
  }

  const review = annotateGrounding(parsed.data, doc.text);
  console.info(JSON.stringify({ event: 'review_grounding', personaId: persona.id, ...review.grounding }));
  send({ type: 'review_done', personaId: persona.id, review, call });
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
