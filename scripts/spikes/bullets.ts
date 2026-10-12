/**
 * SPIKE (Phase 2): can a local model improve a bullet through draft → check →
 * revise, without inventing anything, and does the judge catch what code can't?
 *
 * Cases are *.bullet.json in fixtures/bullets/ and fixtures/private/bullets/.
 * "expect": "pass" → the loop should end with every check passing.
 * "expect": "ask"  → the sources lack a fact the target needs: the honest
 *                     result passes every check AND asks the candidate for it.
 *
 *   npm run spike:bullets                    5 runs per case
 *   npm run spike:bullets -- --only footer --runs 3
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { improveBullet, type BulletTask, type LoopResult } from '@/lib/bullets/loop';
import { getEnv } from '@/lib/env';
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
      const data = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as Omit<Case, 'name'>;
      cases.push({ ...data, notes: data.notes ?? [], name: prefix + file.replace('.bullet.json', '') });
    }
  }
  return cases;
}

function succeeded(c: Case, result: LoopResult): boolean {
  if (result.status !== 'passed') return false;
  if (c.expect === 'ask') return (result.rounds.at(-1)?.questions.length ?? 0) > 0;
  return true;
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Rely on the shell environment.
  }
  const { values } = parseArgs({ options: { runs: { type: 'string', default: '5' }, only: { type: 'string' } } });
  const runs = Number(values.runs);
  getEnv();

  const root = process.cwd();
  const filters = values.only?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const cases = (await loadCases(root)).filter((c) => filters.length === 0 || filters.some((f) => c.name.includes(f)));
  if (cases.length === 0) throw new Error('No *.bullet.json cases found.');

  console.log(`Bullet loop spike: ${cases.length} case(s) × ${runs} run(s) with ${providerName()} / ${modelName()}\n`);
  const records: { case: string; run: number; result: LoopResult }[] = [];

  for (const c of cases) {
    console.log(`${c.name}  (expect: ${c.expect})`);
    for (let run = 1; run <= runs; run++) {
      console.log(`  run ${run}/${runs}`);
      const started = performance.now();
      const result = await improveBullet(c, {
        log: false,
        onRound: (round, i) => {
          const failed = round.checks.filter((ch) => !ch.passed).map((ch) => `${ch.id}: ${ch.detail}`);
          console.log(`    round ${i + 1}: ${round.draft}`);
          console.log(`      ${failed.length ? `✗ ${failed.join(' | ')}` : '✓ all checks passed'}`);
          if (round.dismissed.length) console.log(`      (judge flags dismissed as restating the sources: ${round.dismissed.map((d) => d.claim).join('; ')})`);
          if (round.coverage) console.log(`      coverage ${round.coverage.covered}/${round.coverage.supported} (reported only)`);
          if (round.questions.length) console.log(`      ? ${round.questions.join(' | ')}`);
        },
      });
      records.push({ case: c.name, run, result });
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      console.log(`    → ${result.status}${result.status === 'error' ? `: ${result.message}` : ''}, ${result.rounds.length} round(s), ${seconds} s, ${succeeded(c, result) ? 'SUCCESS' : 'miss'}\n`);
      if (result.status === 'error') break;
    }
  }

  console.log('Summary');
  for (const c of cases) {
    const mine = records.filter((r) => r.case === c.name);
    const ok = mine.filter((r) => succeeded(c, r.result)).length;
    const rounds = mine.map((r) => r.result.rounds.length).sort((a, b) => a - b);
    const caught = (id: string) => mine.reduce((n, r) => n + r.result.rounds.filter((rd) => rd.checks.some((ch) => ch.id === id && !ch.passed)).length, 0);
    console.log(`  ${c.name}`);
    console.log(`    success                    ${ok}/${mine.length}  (expect: ${c.expect})`);
    console.log(`    rounds (median)            ${rounds[Math.floor(rounds.length / 2)] ?? 0}`);
    console.log(`    invented numbers caught    ${caught('numbers')}`);
    console.log(`    invented terms caught      ${caught('terms')}`);
    console.log(`    judge flags                ${caught('claims')}`);
    console.log(`    over length                ${caught('length')}`);
    const dismissed = mine.reduce((n, r) => n + r.result.rounds.reduce((m, rd) => m + rd.dismissed.length, 0), 0);
    console.log(`    judge flags dismissed      ${dismissed}`);
    const finals = mine.map((r) => r.result.rounds.at(-1)?.coverage).filter((x) => x !== undefined);
    if (finals.length) console.log(`    final coverage             ${finals.map((x) => `${x.covered}/${x.supported}`).join(', ')}  (reported only)`);
  }

  const outDir = path.join(root, 'eval-results');
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}_bullets_${providerName()}_${modelName().replace(/[^a-z0-9.-]/gi, '_')}.json`);
  await writeFile(file, JSON.stringify({ meta: { provider: providerName(), model: modelName(), runs }, records }, null, 2));
  console.log(`\nFull results: ${path.relative(root, file)}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
