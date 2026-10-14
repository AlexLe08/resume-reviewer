/**
 * SPIKE: what does the judge catch on its own? Runs it on bullets with a known
 * answer (fixtures/private/bullets/judge-labels.json).
 *
 * The judge runs at temperature 0 and gave identical answers across repeated
 * runs, so one run per bullet is the default: more labeled bullets tell us
 * more than more runs of the same ones.
 *
 *   npm run spike:judge                  1 run per bullet
 *   npm run spike:judge -- --runs 3      check it's still deterministic
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { taskFromFixture } from '@/lib/bullets/fixture';
import { judgeBullet, type BulletTask, type Flag } from '@/lib/bullets/loop';
import { getEnv } from '@/lib/env';
import { gitInfo } from '@/lib/eval/git';
import { modelName, providerName } from '@/lib/llm';

interface Item {
  case: string;
  expect: 'relationship' | 'fact' | 'clean';
  bullet: string;
}

interface JudgeRecord extends Item {
  run: number;
  /** "clean", or the kinds of the flags that stood, joined by "+". */
  verdict: string;
  unsupported: Flag[];
  /** Factual flags dropped because the sources already contain the claim. */
  dismissed: Flag[];
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Rely on the shell environment.
  }
  const { values } = parseArgs({ options: { runs: { type: 'string', default: '1' } } });
  const runs = Number(values.runs);
  getEnv();

  const dir = path.join(process.cwd(), 'fixtures', 'private', 'bullets');
  const { items } = JSON.parse(await readFile(path.join(dir, 'judge-labels.json'), 'utf8')) as { items: Item[] };
  const tasks = new Map<string, BulletTask>();
  for (const name of new Set(items.map((i) => i.case))) {
    tasks.set(name, taskFromFixture(JSON.parse(await readFile(path.join(dir, `${name}.bullet.json`), 'utf8')) as Record<string, unknown>));
  }

  const git = gitInfo();
  console.log(
    `Judge spike: ${items.length} labeled bullet(s) × ${runs} run(s) with ${providerName()} / ${modelName()}\n` +
      `commit: ${git.commit ?? 'unknown'}${git.dirty ? ' (uncommitted changes)' : ''}\n`,
  );
  const tally = { positives: 0, caught: 0, asRelationship: 0, clean: 0, falseAlarms: 0 };
  const records: JudgeRecord[] = [];

  for (const item of items) {
    const kinds: string[] = [];
    const details: string[] = [];
    for (let run = 0; run < runs; run++) {
      const verdict = await judgeBullet(tasks.get(item.case)!, item.bullet, { log: false });
      if (!verdict.ok) throw new Error(verdict.message);
      const flagged = verdict.unsupported;
      const label = flagged.length === 0 ? 'clean' : [...new Set(flagged.map((f) => f.kind))].join('+');
      kinds.push(label);
      records.push({ ...item, run: run + 1, verdict: label, unsupported: flagged, dismissed: verdict.dismissed });
      const prefix = runs > 1 ? `run ${run + 1}: ` : '';
      for (const f of flagged) details.push(`      ${prefix}[${f.kind}] "${f.claim}": ${f.reason}`);
      for (const f of verdict.dismissed) details.push(`      ${prefix}(dismissed) [${f.kind}] "${f.claim}": ${f.reason}`);
      if (item.expect === 'clean') {
        tally.clean++;
        if (flagged.length > 0) tally.falseAlarms++;
      } else {
        tally.positives++;
        if (flagged.length > 0) tally.caught++;
        if (flagged.some((f) => f.kind === 'relationship')) tally.asRelationship++;
      }
    }
    console.log(`  [expect ${item.expect}] ${item.bullet}\n    → ${kinds.join(', ')}`);
    if (details.length) console.log(details.join('\n'));
    console.log('');
  }

  console.log('Summary');
  console.log(`  false links caught (any flag)       ${tally.caught}/${tally.positives}`);
  console.log(`  …flagged as "relationship"           ${tally.asRelationship}/${tally.positives}`);
  console.log(`  correct bullets wrongly flagged      ${tally.falseAlarms}/${tally.clean}`);

  const outDir = path.join(process.cwd(), 'eval-results');
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}_judge_${providerName()}_${modelName().replace(/[^a-z0-9.-]/gi, '_')}.json`);
  await writeFile(file, JSON.stringify({ meta: { provider: providerName(), model: modelName(), runs, git }, tally, records }, null, 2));
  console.log(`\nFull results: ${path.relative(process.cwd(), file)}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
