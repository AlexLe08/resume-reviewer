'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readNdjson } from '@/lib/stream/ndjson';

interface Options<S, E> {
  url: string;
  initial: S;
  /** State to show while the request is starting. */
  starting: (initial: S) => S;
  reduce: (state: S, event: E) => S;
  /** True for the event that ends the stream normally or with an error. */
  isFinal: (event: E) => boolean;
  /** Turn a failure the stream itself didn't report into state. */
  fail: (state: S, message: string) => S;
}

/**
 * POSTs a form and folds the streamed NDJSON events into state with a pure
 * reducer. The reducer is the part worth testing; this hook only does I/O,
 * cancellation, and failures the server never got to report.
 */
export function useNdjsonRequest<S, E>({ url, initial, starting, reduce, isFinal, fail }: Options<S, E>) {
  const [state, setState] = useState<S>(initial);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(
    async (body: FormData) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState(starting(initial));

      try {
        const res = await fetch(url, { method: 'POST', body, signal: controller.signal });
        if (!res.ok || !res.body) {
          const message = await readErrorMessage(res);
          setState((s) => fail(s, message));
          return;
        }
        let finished = false;
        for await (const event of readNdjson<E>(res.body)) {
          if (isFinal(event)) finished = true;
          setState((s) => reduce(s, event));
        }
        if (!finished) setState((s) => fail(s, 'The request stopped before it finished. Try again.'));
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error(err);
        setState((s) => fail(s, 'Lost the connection to the server. Check that it is running and try again.'));
      }
    },
    [url, initial, starting, reduce, isFinal, fail],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => fail(s, 'Canceled.'));
  }, [fail]);

  return { state, start, cancel };
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json();
    if (typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  } catch {
    // Fall through to the generic message.
  }
  return `The server returned an error (${res.status}). Try again.`;
}
