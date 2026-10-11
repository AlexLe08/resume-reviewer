/**
 * A streamed NDJSON response: one JSON event per line. Handles the client going
 * away mid-stream, so callers can call `send` without checking first.
 */
export function ndjsonResponse<E>(run: (send: (event: E) => void) => Promise<void>): Response {
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: E) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true; // The client went away.
        }
      };
      try {
        await run(send);
      } catch (err) {
        console.error('stream_failed', err instanceof Error ? err.message : err);
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
