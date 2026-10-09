/**
 * Evaluates job matching against job fixtures (*.job.json).
 *
 * Extraction and matching are measured separately. Matching runs against the
 * fixture's saved requirement list, not a fresh extraction, so an extraction
 * mistake can't show up as a matching failure, and each run skips a slow call.
 *
 *   npm run eval:jobs                          matching, 3 runs per fixture
 *   npm run eval:jobs -- --stage extract       extraction only
 *   npm run eval:jobs -- --stage both
 *   npm run eval:jobs -- --only job-1 --runs 5
 */
import { execSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { getEnv } from '@/lib/env';
import { loadResume } from '@/lib/eval/fixtures';
import {
  checkExtraction,
  checkMatches,
  findJobFixtures,
  frozenRequirements,
  validateJobFixture,
  type ExtractionCheck,
  type JobFixture,
  type MatchCheck,
} from '@/lib/eval/jobs';
import { extractRequirements } from '@/lib/jobs/extract';
import { matchRequirements } from '@/lib/jobs/match';
import { TIERS } from '@/lib/jobs/schema';
import { modelName, providerName } from '@/lib/llm';
import type { ExtractedDocument } from '@/lib/pdf/extract';

type Stage = 'extract' | 'match' | 'both';

interface ExtractRecord { fixture: string; run: number; ok: boolean; error?: string; latencyMs?: number; check?: ExtractionCheck; extracted?: unknown }
interface MatchRecord { fixture: string; run: number; ok: boolean; error?: string; latencyMs?: number; outputTokens?: number; check?: MatchCheck; report?: unknown }

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Rely on the shell environment.
  }
  const { values } = parseArgs({
    options: {
      runs: { type: 'string', default: '3' },
      only: { type: 'string' },
      stage: { type: 'string', default: 'match' },
    },
  });
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('--runs must be a whole number from 1 to 20.');
  if (!['extract', 'match', 'both'].includes(values.stage)) throw new Error('--stage must be extract, match, or both.');
  const stage = values.stage as Stage;
  getEnv();

  const root = process.cwd();
  const all = await findJobFixtures([
    { dir: path.join(root, 'fixtures', 'jobs'), prefix: '' },
    { dir: path.join(root, 'fixtures', 'private', 'jobs'), prefix: 'private/' },
  ]);
  const filters = values.only?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const fixtures = filters.length > 0 ? all.filter((f) => filters.some((n) => f.name.includes(n))) : all;
  if (fixtures.length === 0) throw new Error('No matching *.job.json fixtures found.');

  // Load and validate everything before any model call.
  const loaded: { fixture: JobFixture; posting: string; doc: ExtractedDocument }[] = [];
  const problems: string[] = [];
  for (const fixture of fixtures) {
    try {
      const posting = await readFile(fixture.postingPath, 'utf8');
      const doc = await loadResume(fixture.resumePath);
      problems.push(...validateJobFixture(fixture, posting).map((p) => `  ${p}`));
      loaded.push({ fixture, posting, doc });
    } catch (err) {
      problems.push(`  ${fixture.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (problems.length > 0) throw new Error(`Fix these fixtures before running:\n${problems.join('\n')}`);

  const git = gitInfo();
  console.log(
    `Job eval (${stage}): ${loaded.length} fixture(s) × ${runs} run(s) with ${providerName()} / ${modelName()}, ` +
      `commit: ${git.commit ?? 'unknown'}${git.dirty ? ' (uncommitted changes)' : ''}\n`,
  );

  const extractRecords: ExtractRecord[] = [];
  const matchRecords: MatchRecord[] = [];

  for (const { fixture, posting, doc } of loaded) {
    for (let run = 1; run <= runs; run++) {
      if (stage !== 'match') {
        process.stdout.write(`  ${fixture.name} extract ${run}/${runs} … `);
        const outcome = await extractRequirements(posting, { log: false });
        if (!outcome.ok) {
          const error = outcome.kind === 'aborted' ? 'aborted' : outcome.message;
          extractRecords.push({ fixture: fixture.name, run, ok: false, error });
          console.log(`failed: ${error}`);
          if (outcome.kind === 'llm_error' && !outcome.retryable) throw new Error('Stopping: this error will not fix itself.');
        } else {
          const check = checkExtraction(outcome.data, fixture);
          extractRecords.push({ fixture: fixture.name, run, ok: true, latencyMs: outcome.call.latencyMs, check, extracted: outcome.data });
          console.log(
            `${(outcome.call.latencyMs / 1000).toFixed(1)} s, found ${check.found}/${check.expected}, tiers ${check.tierCorrect}/${check.found}, ` +
              `extras ${check.extras.length}, forbidden ${check.forbidden.length}, reworded ${check.reworded}`,
          );
        }
      }

      if (stage !== 'extract') {
        process.stdout.write(`  ${fixture.name} match ${run}/${runs} … `);
        const outcome = await matchRequirements(doc, frozenRequirements(fixture), { log: false });
        if (!outcome.ok) {
          const error = outcome.kind === 'aborted' ? 'aborted' : outcome.message;
          matchRecords.push({ fixture: fixture.name, run, ok: false, error });
          console.log(`failed: ${error}`);
          if (outcome.kind === 'llm_error' && !outcome.retryable) throw new Error('Stopping: this error will not fix itself.');
        } else {
          const check = checkMatches(outcome.data, fixture);
          matchRecords.push({
            fixture: fixture.name, run, ok: true, latencyMs: outcome.call.latencyMs,
            outputTokens: outcome.call.outputTokens, check, report: outcome.data,
          });
          const failed = check.requirements.filter((r) => !r.passed).map((r) => r.id);
          console.log(
            `${(outcome.call.latencyMs / 1000).toFixed(1)} s, ${check.requirements.length - failed.length}/${check.requirements.length} accepted` +
              (failed.length > 0 ? ` (failed: #${failed.join(', #')})` : ''),
          );
        }
      }
    }
  }

  for (const { fixture } of loaded) {
    console.log(`\n${fixture.name}`);
    if (stage !== 'match') printExtraction(fixture, extractRecords.filter((r) => r.fixture === fixture.name));
    if (stage !== 'extract') printMatching(fixture, matchRecords.filter((r) => r.fixture === fixture.name));
  }

  const outDir = path.join(root, 'eval-results');
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outDir, `${stamp}_jobs-${stage}_${providerName()}_${modelName().replace(/[^a-z0-9.-]/gi, '_')}.json`);
  const meta = { startedAt: new Date().toISOString(), provider: providerName(), model: modelName(), stage, runsPerFixture: runs, git };
  await writeFile(file, JSON.stringify({ meta, extractRecords, matchRecords }, null, 2));
  console.log(`\nFull results: ${path.relative(root, file)}`);
}

function printExtraction(fixture: JobFixture, records: ExtractRecord[]): void {
  const ok = records.filter((r) => r.ok && r.check);
  const checks = ok.map((r) => r.check!);
  const expected = Object.fromEntries(TIERS.map((t) => [t, fixture.requirements.filter((r) => r.tier === t).length]));
  console.log(`  EXTRACTION  valid runs ${ok.length}/${records.length}, median ${median(ok.map((r) => r.latencyMs))}`);
  if (checks.length === 0) return;
  const sum = (pick: (c: ExtractionCheck) => number) => checks.reduce((s, c) => s + pick(c), 0);
  console.log(`    requirements found   ${sum((c) => c.found)}/${sum((c) => c.expected)}`);
  console.log(`    correct tier         ${sum((c) => c.tierCorrect)}/${sum((c) => c.found)}`);
  console.log(`    reworded             ${sum((c) => c.reworded)}`);
  console.log(`    extras               ${sum((c) => c.extras.length)}`);
  console.log(`    forbidden extracted  ${sum((c) => c.forbidden.length)}`);
  console.log(`    expected per tier    ${TIERS.map((t) => `${t} ${expected[t]}`).join(', ')}`);
  checks.forEach((c, i) => console.log(`    run ${i + 1} per tier      ${TIERS.map((t) => `${t} ${c.countsByTier[t]}`).join(', ')}`));
  const extras = [...new Set(checks.flatMap((c) => [...c.extras, ...c.forbidden]))];
  for (const text of extras.slice(0, 8)) console.log(`    ! extra: ${text.slice(0, 90)}`);
}

function printMatching(fixture: JobFixture, records: MatchRecord[]): void {
  const ok = records.filter((r) => r.ok && r.check);
  const checks = ok.map((r) => r.check!);
  const tokens = ok.map((r) => r.outputTokens ?? 0);
  const avgTokens = tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : 0;
  console.log(`  MATCHING  valid runs ${ok.length}/${records.length}, median ${median(ok.map((r) => r.latencyMs))}, avg ${avgTokens.toLocaleString()} output tokens`);
  if (checks.length === 0) return;

  let passed = 0;
  let total = 0;
  fixture.requirements.forEach((expected, i) => {
    const got = checks.map((c) => c.requirements[i]!);
    const n = got.filter((g) => g.passed).length;
    passed += n;
    total += got.length;
    const mark = n === got.length ? '✓' : n === 0 ? '✗' : '~';
    console.log(
      `    ${mark} ${n}/${got.length}  #${String(i + 1).padStart(2)} [${expected.tier}] ${expected.text.slice(0, 60)}${expected.text.length > 60 ? '…' : ''}` +
        `  (accept ${expected.accept.join('/')}; got ${got.map((g) => g.got).join(', ')})`,
    );
  });
  const quotes = checks.reduce((s, c) => s + c.quotes, 0);
  const found = checks.reduce((s, c) => s + c.quotesFound, 0);
  console.log(`    accepted             ${passed}/${total} (${Math.round((passed / total) * 100)}%)`);
  console.log(`    evidence grounded    ${found}/${quotes}`);
  console.log(`    max evidence reuse   ${checks.map((c) => c.maxEvidenceReuse).join(', ')}  (one passage cited for this many requirements)`);
  console.log(`    empty gaps           ${checks.map((c) => c.emptyGaps).join(', ')}`);
}

function median(values: (number | undefined)[]): string {
  const sorted = values.filter((v): v is number => v !== undefined).sort((a, b) => a - b);
  if (sorted.length === 0) return 'n/a';
  const mid = Math.floor(sorted.length / 2);
  const ms = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Records which version of the code produced these numbers. */
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
