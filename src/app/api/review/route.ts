import { hasUsableText, runChecks } from '@/lib/checks';
import { getEnv } from '@/lib/env';
import { extractResume, jsonError, readForm, readResumeFile } from '@/lib/http/upload';
import { ndjsonResponse } from '@/lib/http/ndjson-response';
import { PERSONAS } from '@/lib/review/personas';
import { runReview } from '@/lib/review/run';
import type { StreamEvent } from '@/lib/stream/events';

// pdf.js needs Node APIs, so this route can't run on the edge runtime.
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/review  (multipart: resume = PDF)
 *
 * Validation failures return a normal JSON error with a 4xx/5xx status.
 * Once the input is valid, we switch to a streamed NDJSON response:
 * extracted → review_started → review_delta* → review_done | reviewer_error → done (or error).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    getEnv();
  } catch (err) {
    console.error('config_error', err instanceof Error ? err.message : err);
    return jsonError(500, 'The server configuration is invalid. Check the terminal and .env.example.');
  }

  const form = await readForm(request);
  if (form instanceof Response) return form;
  const bytes = await readResumeFile(form);
  if (bytes instanceof Response) return bytes;
  const doc = await extractResume(bytes);
  if (doc instanceof Response) return doc;

  const checks = runChecks(doc);
  const persona = PERSONAS.recruiter;
  const signal = request.signal;

  return ndjsonResponse<StreamEvent>(async (send) => {
    send({
      type: 'extracted',
      pageCount: doc.pageCount,
      text: doc.text,
      checks,
      reviewers: [{ id: persona.id, name: persona.name, kind: 'review' }],
    });

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

    send({ type: 'review_started', reviewerId: persona.id });
    const outcome = await runReview(doc, persona, {
      signal,
      onDelta: (text) => send({ type: 'review_delta', reviewerId: persona.id, text }),
    });

    if (outcome.ok) {
      send({ type: 'review_done', reviewerId: persona.id, review: outcome.review, call: outcome.call });
    } else if (outcome.kind === 'aborted') {
      return;
    } else {
      send({
        type: 'reviewer_error',
        reviewerId: persona.id,
        message: outcome.message,
        retryable: outcome.kind === 'llm_error' ? outcome.retryable : true,
      });
    }
    send({ type: 'done' });
  });
}
