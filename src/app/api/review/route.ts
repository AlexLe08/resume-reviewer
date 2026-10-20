import { hasUsableText, runChecks } from '@/lib/checks';
import { DEMO_TODAY, findSample, loadSample } from '@/lib/demo/samples';
import { getEnv } from '@/lib/env';
import { extractResume, jsonError, readForm, readResumeFile } from '@/lib/http/upload';
import type { ExtractedDocument } from '@/lib/pdf/extract';
import { ndjsonResponse } from '@/lib/http/ndjson-response';
import { REVIEWERS, reviewerInfo, runReviewers } from '@/lib/review/reviewers';
import type { StreamEvent } from '@/lib/stream/events';

// pdf.js needs Node APIs, so this route can't run on the edge runtime.
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/review  (multipart: resume = PDF, or sample = a demo sample id)
 *
 * A sample is the demo's alternative to an upload: a public synthetic resume
 * whose model answers were recorded earlier. It only exists when the provider
 * is `replay`, and it runs as of DEMO_TODAY so its prompts match the recordings.
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

  let doc: ExtractedDocument;
  let today: Date | undefined;
  const sampleId = form.get('sample');
  if (typeof sampleId === 'string' && sampleId !== '') {
    if (getEnv().LLM_PROVIDER !== 'replay') return jsonError(400, 'Samples are only available in the demo.');
    const sample = findSample(sampleId);
    if (!sample) return jsonError(404, 'That sample does not exist.');
    doc = await loadSample(sample);
    today = DEMO_TODAY;
  } else {
    const bytes = await readResumeFile(form);
    if (bytes instanceof Response) return bytes;
    const extracted = await extractResume(bytes);
    if (extracted instanceof Response) return extracted;
    doc = extracted;
  }

  const checks = runChecks(doc, today);
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

    await runReviewers(doc, REVIEWERS, send, signal, today);
  });
}
