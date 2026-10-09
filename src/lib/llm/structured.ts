import { z } from 'zod';
import { currentPrices, describeLlmError, modelName, providerName, streamStructured, type TokenUsage } from './index';
import { estimateCostUsd, logCall, type CallRecord } from './usage';

export type StructuredOutcome<T> =
  | { ok: true; data: T; call: CallRecord }
  | { ok: false; kind: 'aborted' }
  | { ok: false; kind: 'llm_error'; message: string; retryable: boolean }
  | { ok: false; kind: 'invalid_output'; message: string; reason: string; call: CallRecord };

export interface StructuredCallOptions<T> {
  /** Shows up in logs and call records, e.g. "review:recruiter". */
  task: string;
  system: string;
  user: string;
  /** Sent to the model as JSON Schema, then used to validate what comes back. */
  schema: z.ZodType<T>;
  temperature?: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  /** Write structured log lines. Evals and CLIs turn this off. */
  log?: boolean;
  /** What the mock provider returns for this call. */
  mockResponse?: () => unknown;
}

/** JSON Schema for a provider. The $schema key is metadata the model APIs don't need. */
export function toProviderSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _unused, ...rest } = z.toJSONSchema(schema);
  return rest;
}

/**
 * One model call with structured output: stream, record usage, validate.
 * Every pipeline (reviews, requirement extraction, matching) goes through
 * here, so retries, logging, cost estimates, and validation behave the same
 * everywhere.
 */
export async function callStructured<T>(options: StructuredCallOptions<T>): Promise<StructuredOutcome<T>> {
  const { task, signal, onDelta, log = true } = options;
  const started = performance.now();
  let raw = '';
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
  let servedModel: string | undefined;

  try {
    const chunks = streamStructured({
      system: options.system,
      user: options.user,
      jsonSchema: toProviderSchema(options.schema),
      temperature: options.temperature,
      signal,
      mockResponse: options.mockResponse,
    });
    for await (const chunk of chunks) {
      if (chunk.text) {
        raw += chunk.text;
        onDelta?.(chunk.text);
      }
      if (chunk.usage) usage = chunk.usage;
      if (chunk.model) servedModel = chunk.model;
    }
  } catch (err) {
    if (signal?.aborted) return { ok: false, kind: 'aborted' };
    if (log) console.error('llm_call_failed', task, err instanceof Error ? err.message : err);
    return { ok: false, kind: 'llm_error', ...describeLlmError(err) };
  }

  const call: CallRecord = {
    provider: providerName(),
    model: servedModel ?? modelName(),
    task,
    latencyMs: Math.round(performance.now() - started),
    ...usage,
    estimatedCostUsd: estimateCostUsd(usage, currentPrices()),
  };
  // Log before validating, so failed calls still show up in usage numbers.
  if (log) logCall(call);

  const parsed = parseStructured(raw, options.schema);
  if (!parsed.success) {
    if (log) console.error('structured_output_invalid', task, parsed.reason);
    return {
      ok: false,
      kind: 'invalid_output',
      message: 'The model returned an incomplete result. Try again.',
      reason: parsed.reason,
      call,
    };
  }
  return { ok: true, data: parsed.data, call };
}

export function parseStructured<T>(
  raw: string,
  schema: z.ZodType<T>,
): { success: true; data: T } | { success: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { success: false, reason: 'The model returned text that is not valid JSON.' };
  }
  const result = schema.safeParse(json);
  return result.success ? { success: true, data: result.data } : { success: false, reason: z.prettifyError(result.error) };
}
