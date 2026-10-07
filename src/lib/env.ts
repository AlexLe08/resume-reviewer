import { z } from 'zod';

const EnvSchema = z.object({
  GEMINI_API_KEY: z
    .string()
    .min(1, 'GEMINI_API_KEY is missing. Copy .env.example to .env.local and add your key.'),
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  LLM_INPUT_PRICE_PER_MTOK: z.coerce.number().nonnegative().default(0),
  LLM_OUTPUT_PRICE_PER_MTOK: z.coerce.number().nonnegative().default(0),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/**
 * Validated server-side config. Read lazily (not at import time) so that
 * `next build` and the unit tests work without a .env.local present.
 */
export function getEnv(): Env {
  cached ??= EnvSchema.parse(process.env);
  return cached;
}
