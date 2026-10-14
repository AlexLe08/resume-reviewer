/**
 * SPIKE (Phase 2): bullet improvement with candidates. One call drafts up to
 * three candidates from different angles; each is checked and, if it fails,
 * revised on its own. The person picks from those that pass.
 *
 * Cases are *.bullet.json in fixtures/bullets/ and fixtures/private/bullets/.
 * "expect": "pass" → at least one candidate should pass every check.
 * "expect": "ask"  → the sources lack a fact the target needs: the honest
 *                     result is candidates that pass AND a question for it.
 *
 *   npm run spike:bullets                    3 runs per case
 *   npm run spike:bullets -- --only footer --runs 2
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { extractNumbers, stems } from '@/lib/bullets/checks';
import { taskFromFixture } from '@/lib/bullets/fixture';
import { improveBullet, sourcesText, type BulletTask, type LoopResult } from '@/lib/bullets/loop';
import { getEnv } from '@/lib/env';
import { gitInfo } from '@/lib/eval/git';
import { modelName, providerName } from '@/lib/llm';

interface Case extends BulletTask {
  name: string;
  description: string;
  expect: 'pass' | 'ask';
}

async function loadCases(root: string): Promise<Case[]> {
  const cases: Case[] = [];
  for (const [dir, prefix] of [[path.join(root, 'fixtures', 'bullets'), ''], [path.join(root, 'fixtures', 'private', 'bullets'), 'private/']] as const) {
    let files: string[] = [];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith('.bullet.json')).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const data = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as Record<string, unknown>;
      const task = taskFromFixture(data);
      cases.push({
        ...task,
        name: prefix + file.replace('.bullet.json', ''),
        description: String(data.description ?? ''),
        expect: data.expect === 'ask' ? 'ask' : 'pass',
      });
    }
  }
  return cases;
}

const passedBullets = (r: LoopResult) => r.candidates.filter((c) => c.status === 'passed').map((c) => c.rounds.at(-1)!.draft);

function succeeded(c: Case, r: LoopResult): boolean {
  if (r.status !== 'done' || passedBullets(r).length === 0) return false;
  return c.expect === 'ask' ? r.questions.length > 0 : true;
}

/** Highest word overlap between any two passing candidates (0 = nothing shared, 1 = identical). */
function maxOverlap(bullets: string[]): number {
  let max = 0;
  for (let i = 0; i < bullets.length; i++) {
    for (let j = i + 1; j < bullets.length; j++) {
      const a = new Set(stems(bullets[i]!));
      const b = new Set(stems(bullets[j]!));
      const shared = [...a].filter((s) => b.has(s)).length;
      max = Math.max(max, shared / (a.size + b.size - shared || 1));
    }
  }
  return max;
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Rely on the shell environment.
  }
  const { values } = parseArgs({ options: { runs: { type: 'string', default: '3' }, only: { type: 'string' } } });
  const runs = Number(values.runs);
  getEnv();

  const root = process.cwd();
  const filters = values.only?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const cases = (await loadCases(root)).filter((c) => filters.length === 0 || filters.some((f) => c.name.includes(f)));
  if (cases.length === 0) throw new Error('No *.bullet.json cases found.');

  const git = gitInfo();
  console.log(
    `Bullet candidates spike: ${cases.length} case(s) × ${runs} run(s) with ${providerName()} / ${modelName()}\n` +
      `commit: ${git.commit ?? 'unknown'}${git.dirty ? ' (uncommitted changes)' : ''}\n`,
  );
  const records: { case: string; run: number; result: LoopResult; seconds: number }[] = [];

  for (const c of cases) {
    console.log(`${c.name}  (expect: ${c.expect}${c.avoid?.length ? `, avoid: ${c.avoid.join(', ')}` : ''})`);
    for (let run = 1; run <= runs; run++) {
      console.log(`  run ${run}/${runs}`);
      const started = performance.now();
      const result = await improveBullet(c, {
        log: false,
        onRound: (i, round, r) => {
          const failed = round.checks.filter((ch) => !ch.passed).map((ch) => `${ch.id}: ${ch.detail}`);
          console.log(`    [${i + 1}] round ${r + 1}: ${round.draft}`);
          console.log(`        ${failed.length ? `✗ ${failed.join(' | ')}` : '✓ passed'}${round.coverage ? `  (coverage ${round.coverage.covered}/${round.coverage.supported})` : ''}`);
          if (round.dismissed.length) console.log(`        (dismissed judge flags: ${round.dismissed.map((d) => d.claim).join('; ')})`);
        },
      });
      const seconds = (performance.now() - started) / 1000;
      records.push({ case: c.name, run, result, seconds });
      if (result.status === 'done') {
        result.candidates.forEach((cand, i) => console.log(`    [${i + 1}] angle: ${cand.angle} → ${cand.status}`));
        if (result.questions.length) console.log(`    ? ${result.questions.join(' | ')}`);
      }
      console.log(`    → ${passedBullets(result).length} passing candidate(s), ${seconds.toFixed(1)} s, ${succeeded(c, result) ? 'SUCCESS' : 'miss'}${result.status === 'error' ? ` (${result.message})` : ''}\n`);
      if (result.status === 'error') break;
    }
  }

  console.log('Summary');
  for (const c of cases) {
    const mine = records.filter((r) => r.case === c.name);
    const all = mine.flatMap((r) => r.result.candidates);
    const rounds = mine.flatMap((r) => r.result.candidates.flatMap((cand) => cand.rounds));
    const caught = (id: string) => rounds.filter((rd) => rd.checks.some((ch) => ch.id === id && !ch.passed)).length;
    const overlaps = mine.map((r) => maxOverlap(passedBullets(r.result))).sort((a, b) => a - b);
    const times = mine.map((r) => r.seconds).sort((a, b) => a - b);
    console.log(`  ${c.name}`);
    console.log(`    success                    ${mine.filter((r) => succeeded(c, r.result)).length}/${mine.length}  (expect: ${c.expect})`);
    console.log(`    candidates passing         ${all.filter((x) => x.status === 'passed').length}/${all.length}`);
    console.log(`    runs with 2+ passing       ${mine.filter((r) => passedBullets(r.result).length >= 2).length}/${mine.length}`);
    console.log(`    revisions                  ${rounds.length - all.length}`);
    console.log(`    caught: numbers ${caught('numbers')}, terms ${caught('terms')}, style ${caught('style')}, length ${caught('length')}, judge ${caught('claims')}`);
    console.log(`    judge flags dismissed      ${rounds.reduce((n, rd) => n + rd.dismissed.length, 0)}`);
    const relationships = rounds.reduce((n, rd) => n + rd.unsupported.filter((u) => u.kind === 'relationship').length, 0);
    console.log(`    relationship flags         ${relationships}`);
    const sourceNumbers = extractNumbers(sourcesText(c));
    const passing = mine.flatMap((r) => passedBullets(r.result));
    const withNumbers = passing.filter((bullet) => [...extractNumbers(bullet)].some((n) => sourceNumbers.has(n))).length;
    console.log(`    passing with a source number ${withNumbers}/${passing.length}`);
    console.log(`    max overlap (median)       ${(overlaps[Math.floor(overlaps.length / 2)] ?? 0).toFixed(2)}  (between passing candidates; lower = more distinct)`);
    console.log(`    time per run (median)      ${(times[Math.floor(times.length / 2)] ?? 0).toFixed(1)} s`);
  }

  const outDir = path.join(root, 'eval-results');
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}_bullets_${providerName()}_${modelName().replace(/[^a-z0-9.-]/gi, '_')}.json`);
  await writeFile(file, JSON.stringify({ meta: { provider: providerName(), model: modelName(), runs, git }, records }, null, 2));
  console.log(`\nFull results: ${path.relative(root, file)}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
