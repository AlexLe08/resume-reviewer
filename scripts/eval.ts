/**
 * Runs the real review pipeline against fixture resumes and reports how often
 * each expectation holds. Usage:
 *
 *   npm run eval                          all fixtures, 3 runs each
 *   npm run eval -- --runs 1              quick pass
 *   npm run eval -- --only recent-gap     one fixture (matches by name)
 *   LLM_PROVIDER=gemini npm run eval      override a setting for one run
 */
import { execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { getEnv } from '@/lib/env';
import { checkExpectations } from '@/lib/eval/assertions';
import { findFixtures, validateFixture, loadResume } from '@/lib/eval/fixtures';
import { formatSummary, summarize, type RunRecord } from '@/lib/eval/report';
import { modelName, providerName } from '@/lib/llm';
import { PERSONAS, type PersonaId } from '@/lib/review/personas';
import { runReview } from '@/lib/review/run';

async function main(): Promise<void> {
  // Settings already in the shell win over .env.local, so one-off overrides work.
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // No .env.local: rely on the shell environment.
  }

  const { values } = parseArgs({
    options: {
      runs: { type: 'string', default: '3' },
      only: { type: 'string' },
      persona: { type: 'string', default: 'recruiter' },
    },
  });

  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) {
    throw new Error('--runs must be a whole number from 1 to 20.');
  }
  if (!Object.hasOwn(PERSONAS, values.persona)) {
    throw new Error(`Unknown persona "${values.persona}". Options: ${Object.keys(PERSONAS).join(', ')}.`);
  }
  const persona = PERSONAS[values.persona as PersonaId];

  getEnv(); // Fail fast on bad configuration, before any slow work.

  const root = process.cwd();
  const all = await findFixtures([
    { dir: path.join(root, 'fixtures'), prefix: '' },
    { dir: path.join(root, 'fixtures', 'private'), prefix: 'private/' },
  ]);
  const fixtures = values.only ? all.filter((f) => f.name.includes(values.only ?? '')) : all;
  if (fixtures.length === 0) {
    throw new Error(values.only ? `No fixture name contains "${values.only}".` : 'No *.eval.json files found in fixtures/.');
  }

  const git = gitInfo();
  console.log(
    `Evaluating ${fixtures.length} fixture(s) × ${runs} run(s) with ${providerName()} / ${modelName()}, ` +
      `persona: ${persona.id}, commit: ${git.commit ?? 'unknown'}${git.dirty ? ' (uncommitted changes)' : ''}\n`,
  );

  const records: RunRecord[] = [];
  let stopped = false;

  // Load every resume before any model call: a broken fixture should fail in
  // one second, not get skipped quietly halfway through a 30-minute run.
  const loaded: { fixture: (typeof fixtures)[number]; doc: Awaited<ReturnType<typeof loadResume>> }[] = [];
  const problems: string[] = [];
  for (const fixture of fixtures) {
    try {
      const doc = await loadResume(fixture.resumePath);
      problems.push(...validateFixture(fixture, doc).map((p) => `  ${p}`));
      loaded.push({ fixture, doc });
    } catch (err) {
      problems.push(`  ${fixture.name}: couldn't read ${fixture.resumePath} (${err instanceof Error ? err.message : err})`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Fix these fixtures before running:\n${problems.join('\n')}`);
  }

  for (const { fixture, doc } of loaded) {
    for (let run = 1; run <= runs; run++) {
      process.stdout.write(`  ${fixture.name} ${run}/${runs} … `);
      const outcome = await runReview(doc, persona, { log: false });

      if (outcome.ok) {
        const assertions = checkExpectations(outcome.review, fixture.expect);
        records.push({
          fixture: fixture.name,
          run,
          status: 'ok',
          latencyMs: outcome.call.latencyMs,
          outputTokens: outcome.call.outputTokens,
          verdict: outcome.review.wouldAdvance,
          grounding: outcome.review.grounding,
          assertions,
          review: outcome.review,
        });
        const failed = assertions.filter((a) => !a.passed);
        const { found, quotes } = outcome.review.grounding;
        console.log(
          `${(outcome.call.latencyMs / 1000).toFixed(1)} s, ${found}/${quotes} quotes, ` +
            (failed.length === 0 ? 'all checks passed' : `failed: ${failed.map((a) => a.id).join(', ')}`),
        );
        continue;
      }

      if (outcome.kind === 'aborted') {
        stopped = true;
        break;
      }

      records.push({
        fixture: fixture.name,
        run,
        status: outcome.kind,
        error: outcome.kind === 'invalid_output' ? outcome.reason : outcome.message,
        latencyMs: outcome.kind === 'invalid_output' ? outcome.call.latencyMs : undefined,
        assertions: [],
      });
      console.log(`failed: ${outcome.message}`);

      if (outcome.kind === 'llm_error' && !outcome.retryable) {
        console.error('\nStopping: this error will not fix itself between runs.');
        stopped = true;
        break;
      }
    }
    if (stopped) break;
  }

  const summaries = summarize(records);
  console.log(formatSummary(summaries));

  // Results include review text quoting the resumes, so eval-results/ is gitignored.
  const outDir = path.join(root, 'eval-results');
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outDir, `${stamp}_${providerName()}_${modelName().replace(/[^a-z0-9.-]/gi, '_')}.json`);
  const meta = {
    startedAt: new Date().toISOString(),
    provider: providerName(),
    model: modelName(),
    persona: persona.id,
    runsPerFixture: runs,
    git,
  };
  await writeFile(file, JSON.stringify({ meta, summaries, records }, null, 2));
  console.log(`\nFull results: ${path.relative(root, file)}`);
}

/** Records which version of the prompt and code produced these numbers. */
function gitInfo(): { commit: string | null; dirty: boolean | null } {
  try {
    const run = (cmd: string) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return { commit: run('git rev-parse --short HEAD'), dirty: run('git status --porcelain').length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
