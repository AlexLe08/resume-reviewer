import { hasUsableText, runChecks } from '@/lib/checks';
import { getEnv } from '@/lib/env';
import { extractResume, jsonError, readForm, readResumeFile } from '@/lib/http/upload';
import { ndjsonResponse } from '@/lib/http/ndjson-response';
import { REVIEWERS, reviewerInfo, runReviewers } from '@/lib/review/reviewers';
import type { StreamEvent } from '@/lib/stream/events';

// pdf.js needs Node APIs, so this route can't run on the edge runtime.
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/review  (multipart: resume = PDF)
 *
 * Validation failures return a normal JSON error with a 4xx/5xx status.
 * Once the input is valid, we switch to a streamed NDJSON response:
 * extracted → per reviewer, one after another: review_started → review_delta* →
 * review_done | proofread_done | reviewer_error → done (or a fatal error).
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
  const signal = request.signal;

  return ndjsonResponse<StreamEvent>(async (send) => {
    send({
      type: 'extracted',
      pageCount: doc.pageCount,
      text: doc.text,
      checks,
      reviewers: reviewerInfo(REVIEWERS),
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

    await runReviewers(doc, REVIEWERS, send, signal);
  });
}
