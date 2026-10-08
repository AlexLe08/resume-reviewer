import type { StreamChunk } from './types';

// Server-side failures that usually clear up on their own. 429 is excluded on
// purpose: on the free tier it usually means a quota is used up, and an
// immediate retry just gets rejected again.
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  signal?: AbortSignal;
  onRetry?: (info: { attempt: number; delayMs: number; status: number }) => void;
}

export function errorStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = Number(err.status);
    return Number.isFinite(status) ? status : undefined;
  }
  return undefined;
}

/**
 * Retries a streaming call if it fails BEFORE the first chunk arrives.
 * Once text has been sent onward, a retry would mix two different responses,
 * so later errors are passed through to the caller unchanged.
 */
export async function* withRetry(
  start: () => AsyncGenerator<StreamChunk>,
  options: RetryOptions,
): AsyncGenerator<StreamChunk> {
  for (let attempt = 1; ; attempt++) {
    const stream = start();
    let first: IteratorResult<StreamChunk>;

    try {
      first = await stream.next();
    } catch (err) {
      const status = errorStatus(err);
      const canRetry =
        status !== undefined &&
        RETRYABLE_STATUSES.has(status) &&
        attempt < options.attempts &&
        !options.signal?.aborted;
      if (!canRetry) throw err;

      const delayMs = backoffDelay(attempt, options.baseDelayMs);
      options.onRetry?.({ attempt, delayMs, status });
      await sleep(delayMs, options.signal);
      continue;
    }

    if (first.done) return;
    yield first.value;
    yield* stream;
    return;
  }
}

/** Exponential backoff with jitter: a random delay between half and all of base × 2^(attempt-1). */
function backoffDelay(attempt: number, baseDelayMs: number): number {
  const ceiling = baseDelayMs * 2 ** (attempt - 1);
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
