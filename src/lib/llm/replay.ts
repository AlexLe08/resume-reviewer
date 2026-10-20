import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ProviderError } from './errors';
import type { StreamChunk, StructuredStreamRequest, TokenUsage } from './types';

type Provider = (request: StructuredStreamRequest) => AsyncGenerator<StreamChunk>;

const RecordingSchema = z.object({
  key: z.string(),
  model: z.string(),
  recordedAt: z.string(),
  latencyMs: z.number(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number(), thinkingTokens: z.number() }),
  /** The model's raw answer, exactly as it streamed. */
  text: z.string(),
});

export type Recording = z.infer<typeof RecordingSchema>;

/**
 * Identifies a request by what the model would see: both prompts and the output
 * schema. Change a persona, a fact or the schema and the key changes, so an old
 * recording can never be shown for a new prompt.
 */
export function requestKey(request: Pick<StructuredStreamRequest, 'system' | 'user' | 'jsonSchema'>): string {
  return createHash('sha256')
    .update(JSON.stringify([request.system, request.user, request.jsonSchema]))
    .digest('hex')
    .slice(0, 32);
}

function recordingPath(dir: string, key: string): string {
  return path.join(dir, `${key}.json`);
}

export async function readRecording(dir: string, key: string): Promise<Recording | undefined> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(recordingPath(dir, key), 'utf8'));
  } catch {
    return undefined;
  }
  const parsed = RecordingSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

const CHUNK_SIZE = 48;

/**
 * Plays back what a real model said earlier: no network, no model. Everything
 * after the model call (grounding, the verdict cap, the UI) still runs for real,
 * so a demo built on this exercises the actual pipeline.
 */
export function createReplayProvider(config: { dir: string; delayMs: number }): Provider {
  return async function* streamReplay(request) {
    const key = requestKey(request);
    const recording = await readRecording(config.dir, key);
    if (!recording) {
      throw new ProviderError(
        'This demo only has recorded reviews for its sample resumes. Pick a sample, or run the app locally to review your own.',
        'no_recording',
      );
    }
    for (let i = 0; i < recording.text.length; i += CHUNK_SIZE) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error('Aborted');
      if (config.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, config.delayMs));
      yield { text: recording.text.slice(i, i + CHUNK_SIZE), model: recording.model };
    }
    yield { text: '', model: recording.model, usage: recording.usage };
  };
}

/**
 * Wraps a real provider and saves each completed answer, for `npm run demo:record`.
 * A call that fails or is aborted saves nothing.
 */
export function withRecording(inner: Provider, dir: string): Provider {
  return async function* streamRecorded(request) {
    const started = performance.now();
    let text = '';
    let model = 'unknown';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
    for await (const chunk of inner(request)) {
      text += chunk.text;
      if (chunk.model) model = chunk.model;
      if (chunk.usage) usage = chunk.usage;
      yield chunk;
    }
    const key = requestKey(request);
    const recording: Recording = {
      key,
      model,
      recordedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started),
      usage,
      text,
    };
    await mkdir(dir, { recursive: true });
    await writeFile(recordingPath(dir, key), JSON.stringify(recording, null, 2));
  };
}
