import { z } from 'zod';
import { improveBullet } from '@/lib/bullets/loop';
import { BulletRequestSchema } from '@/lib/bullets/request';
import { getEnv } from '@/lib/env';
import { ndjsonResponse } from '@/lib/http/ndjson-response';
import { jsonError, readForm } from '@/lib/http/upload';
import type { BulletStreamEvent } from '@/lib/stream/bullet-events';

export const runtime = 'nodejs';
// Several model calls on a local model; only enforced where the platform enforces it.
export const maxDuration = 300;

/**
 * POST /api/bullets  (multipart: task = JSON, see BulletRequestSchema)
 *
 * Streams candidates as they're drafted, checked, and revised. Notes are used
 * for this request only and never stored.
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
  let json: unknown;
  try {
    json = JSON.parse(String(form.get('task') ?? ''));
  } catch {
    return jsonError(400, 'Send the task as JSON in the "task" field.');
  }
  const parsed = BulletRequestSchema.safeParse(json);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? z.prettifyError(parsed.error));
  const task = parsed.data;

  return ndjsonResponse<BulletStreamEvent>(async (send) => {
    const result = await improveBullet(
      { ...task, target: task.target || undefined, role: task.role || undefined },
      {
        signal: request.signal,
        onDrafted: (candidates, questions) => send({ type: 'drafted', candidates, questions }),
        onRound: (index, round, roundIndex) =>
          send({
            type: 'round',
            index,
            roundIndex,
            draft: round.draft,
            passed: round.checks.every((c) => c.passed),
            failing: round.checks.filter((c) => !c.passed).map((c) => c.id),
          }),
        onCandidateDone: (index, candidate) =>
          send({ type: 'candidate_done', index, status: candidate.status, bullet: candidate.rounds.at(-1)?.draft ?? '' }),
      },
    );
    if (result.status === 'error') {
      if (!request.signal.aborted) send({ type: 'error', message: result.message, retryable: true });
      return;
    }
    send({ type: 'done' });
  });
}
