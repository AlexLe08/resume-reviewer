import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '@/lib/stream/events';

/** The route reads cached settings, so each test loads a fresh copy under its own provider. */
async function post(provider: 'replay' | 'mock', fields: Record<string, string>): Promise<Response> {
  vi.resetModules();
  process.env.LLM_PROVIDER = provider;
  process.env.MOCK_DELAY_MS = '0';
  const { POST } = await import('./route');
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return POST(new Request('http://localhost/api/review', { method: 'POST', body: form }));
}

async function events(response: Response): Promise<StreamEvent[]> {
  return (await response.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StreamEvent);
}

beforeEach(() => {
  vi.resetModules();
});

describe('POST /api/review with a demo sample', () => {
  it('streams the recorded reviews for a sample, with no reviewer failing', async () => {
    const response = await post('replay', { sample: 'weak-duties' });
    expect(response.status).toBe(200);
    const stream = await events(response);
    expect(stream[0]?.type).toBe('extracted');
    expect(stream.filter((e) => e.type === 'reviewer_error')).toEqual([]);
    expect(stream.filter((e) => e.type === 'review_done' || e.type === 'proofread_done')).toHaveLength(3);
    expect(stream.at(-1)).toEqual({ type: 'done' });
  });

  it('refuses an unknown sample, including a path into the private folder', async () => {
    for (const id of ['nope', 'private/my-resume', '../fixtures/weak-duties']) {
      const response = await post('replay', { sample: id });
      expect(response.status).toBe(404);
    }
  });

  it('refuses samples when the demo provider is not in use', async () => {
    const response = await post('mock', { sample: 'weak-duties' });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('only available in the demo');
  });

  it('still asks for a PDF when there is no sample', async () => {
    const response = await post('replay', {});
    expect(response.status).toBe(400);
  });
});
