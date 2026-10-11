import { hasUsableText } from '@/lib/checks';
import { getEnv } from '@/lib/env';
import { extractResume, jsonError, readForm, readResumeFile } from '@/lib/http/upload';
import { ndjsonResponse } from '@/lib/http/ndjson-response';
import { extractRequirements } from '@/lib/jobs/extract';
import { matchRequirements } from '@/lib/jobs/match';
import type { MatchStreamEvent } from '@/lib/stream/match-events';

// pdf.js needs Node APIs, so this route can't run on the edge runtime.
export const runtime = 'nodejs';
// Two model calls on a local model can take several minutes. This only applies
// where the platform enforces it; the dev server doesn't.
export const maxDuration = 300;

const MIN_POSTING_CHARS = 100;
const MAX_POSTING_CHARS = 20_000;

/**
 * POST /api/match  (multipart: resume = PDF, posting = text)
 *
 * Validation failures return a JSON error. Then a streamed NDJSON response:
 * each requirement as it's extracted, then each result as it's matched.
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

  const posting = form.get('posting');
  if (typeof posting !== 'string' || posting.trim().length < MIN_POSTING_CHARS) {
    return jsonError(400, 'Paste the full job posting, including its requirements.');
  }
  if (posting.length > MAX_POSTING_CHARS) {
    return jsonError(413, 'That posting is over 20,000 characters. Paste just the job description.');
  }

  const bytes = await readResumeFile(form);
  if (bytes instanceof Response) return bytes;
  const doc = await extractResume(bytes);
  if (doc instanceof Response) return doc;
  if (!hasUsableText(doc)) {
    return jsonError(422, "This PDF has almost no selectable text, so it can't be matched. Export it again as a text PDF.");
  }

  const signal = request.signal;
  return ndjsonResponse<MatchStreamEvent>(async (send) => {
    send({ type: 'resume_read', pageCount: doc.pageCount });

    const extracted = await extractRequirements(posting, {
      signal,
      onRequirement: (requirement) => send({ type: 'requirement', requirement }),
    });
    if (!extracted.ok) {
      if (extracted.kind !== 'aborted') {
        send({
          type: 'error',
          stage: 'requirements',
          message: extracted.message,
          retryable: extracted.kind === 'llm_error' ? extracted.retryable : true,
        });
      }
      return;
    }
    if (extracted.data.length === 0) {
      send({
        type: 'error',
        stage: 'requirements',
        message: "No requirements were found in that posting. Check that it includes the qualifications section.",
        retryable: false,
      });
      return;
    }
    send({ type: 'requirements_done', requirements: extracted.data, call: extracted.call });

    const matched = await matchRequirements(doc, extracted.data, {
      signal,
      onMatch: (match) => send({ type: 'match', match }),
    });
    if (!matched.ok) {
      if (matched.kind !== 'aborted') {
        send({
          type: 'error',
          stage: 'match',
          message: matched.message,
          retryable: matched.kind === 'llm_error' ? matched.retryable : true,
        });
      }
      return;
    }
    send({ type: 'match_done', report: matched.data, call: matched.call });
  });
}
