import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { modelName, providerName } from '@/lib/llm';

/** Settings already in the shell win over .env.local, so one-off overrides work. */
export function loadLocalEnv(): void {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // No .env.local: rely on the shell environment.
  }
}

/**
 * Writes `<timestamp>_<tag>_<provider>_<model>.json` into eval-results/ (gitignored: results can
 * quote resumes) and returns its path relative to the working directory. `tag` is optional.
 */
export async function saveResults(tag: string | null, payload: unknown): Promise<string> {
  const outDir = path.join(process.cwd(), 'eval-results');
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const model = modelName().replace(/[^a-z0-9.-]/gi, '_');
  const name = [stamp, tag, providerName(), model].filter(Boolean).join('_');
  const file = path.join(outDir, `${name}.json`);
  await writeFile(file, JSON.stringify(payload, null, 2));
  return path.relative(process.cwd(), file);
}
