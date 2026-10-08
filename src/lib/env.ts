import { z } from 'zod';

const EnvSchema = z
  .object({
    /** Which model provider handles reviews. See README "Model providers". */
    LLM_PROVIDER: z.enum(['ollama', 'gemini', 'mock']).default('ollama'),

    // 127.0.0.1 rather than "localhost": Node can resolve localhost to the IPv6
    // address ::1, while Ollama listens on IPv4 by default.
    OLLAMA_BASE_URL: z.url().default('http://127.0.0.1:11434'),
    OLLAMA_MODEL: z.string().min(1).default('gemma4:e4b'),
    /** Context window in tokens. Bigger costs memory; a resume review needs well under this. */
    OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(8192),

    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().min(1).default('gemini-3.8-flash'),

    /** Pause between streamed chunks from the mock provider, to make streaming visible. */
    MOCK_DELAY_MS: z.coerce.number().int().nonnegative().default(25),

    LLM_INPUT_PRICE_PER_MTOK: z.coerce.number().nonnegative().default(0),
    LLM_OUTPUT_PRICE_PER_MTOK: z.coerce.number().nonnegative().default(0),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GEMINI_API_KEY'],
        message: 'GEMINI_API_KEY is required when LLM_PROVIDER=gemini. Add it to .env.local.',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/**
 * Validated server-side config. Read lazily (not at import time) so that
 * `next build` and the unit tests work without a .env.local present.
 *
 * Cached for the life of the server process: restart `npm run dev` after
 * editing .env.local.
 */
export function getEnv(): Env {
  cached ??= EnvSchema.parse(process.env);
  return cached;
}
