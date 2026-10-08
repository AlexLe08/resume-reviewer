import { readNdjson } from '@/lib/stream/ndjson';
import { ProviderError } from './errors';
import type { StreamChunk, StructuredStreamRequest } from './types';

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  numCtx: number;
  /** Injectable for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** One line of Ollama's streamed /api/chat response. */
interface OllamaChatLine {
  model?: string;
  message?: { content?: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/**
 * Talks to a local Ollama server over its HTTP API. No SDK: it's one POST
 * that streams back newline-delimited JSON, which we already know how to read.
 */
export function createOllamaProvider(config: OllamaConfig) {
  const fetchImpl = config.fetchImpl ?? fetch;

  return async function* streamStructuredOllama(
    request: StructuredStreamRequest,
  ): AsyncGenerator<StreamChunk> {
    let res: Response;
    try {
      res = await fetchImpl(`${config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: request.signal,
        body: JSON.stringify({
          model: config.model,
          stream: true,
          // Ollama constrains generation to this JSON Schema.
          format: request.jsonSchema,
          options: { temperature: request.temperature, num_ctx: config.numCtx },
          messages: [
            { role: 'system', content: withSchemaHint(request.system, request.jsonSchema) },
            { role: 'user', content: request.user },
          ],
        }),
      });
    } catch (err) {
      if (request.signal?.aborted) throw err;
      throw new ProviderError(
        `Can't reach Ollama at ${config.baseUrl}. Start it with \`ollama serve\` and try again.`,
        'unreachable',
        undefined,
        { cause: err },
      );
    }

    if (!res.ok || !res.body) {
      if (res.status === 404) {
        throw new ProviderError(
          `Ollama doesn't have the model "${config.model}". Download it with \`ollama pull ${config.model}\`.`,
          'model_not_found',
          404,
        );
      }
      if (res.status === 501) {
        throw new ProviderError(
          `This Ollama install can't produce structured output with "${config.model}". ` +
            'On Macs this usually means an MLX model on a Homebrew-built Ollama. ' +
            'Use a GGUF tag of the model (e.g. one ending in -q4_K_M) or the official Ollama build.',
          'structured_output_unsupported',
          501,
        );
      }
      throw new ProviderError(`Ollama returned ${res.status}: ${await readErrorText(res)}`, 'http', res.status);
    }

    for await (const line of readNdjson<OllamaChatLine>(res.body)) {
      if (line.error) throw new ProviderError(`Ollama error: ${line.error}`, 'bad_response', 500);
      yield {
        text: line.message?.content ?? '',
        model: line.model,
        usage: line.done
          ? {
              inputTokens: line.prompt_eval_count ?? 0,
              outputTokens: line.eval_count ?? 0,
              thinkingTokens: 0,
            }
          : undefined,
      };
    }
  };
}

/**
 * Small local models follow a schema more reliably when they can also read it.
 * Hosted models with native structured output don't need this, so it lives
 * here rather than in the shared prompt.
 */
function withSchemaHint(system: string, schema: Record<string, unknown>): string {
  return `${system}\n\nRespond with only a JSON object that matches this JSON Schema:\n${JSON.stringify(schema)}`;
}

async function readErrorText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) return String(parsed.error);
    } catch {
      // Not JSON; fall through to the raw text.
    }
    return text.slice(0, 300);
  } catch {
    return 'no details';
  }
}
