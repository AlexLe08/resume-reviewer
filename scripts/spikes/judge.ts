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
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { taskFromFixture } from '@/lib/bullets/fixture';
import { judgeBullet, type BulletTask } from '@/lib/bullets/loop';
import { getEnv } from '@/lib/env';
import { modelName, providerName } from '@/lib/llm';

interface Item {
  case: string;
  expect: 'relationship' | 'fact' | 'clean';
  bullet: string;
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

  console.log(`Judge spike: ${items.length} labeled bullet(s) × ${runs} run(s) with ${providerName()} / ${modelName()}\n`);
  const tally = { positives: 0, caught: 0, asRelationship: 0, clean: 0, falseAlarms: 0 };

  for (const item of items) {
    const kinds: string[] = [];
    for (let run = 0; run < runs; run++) {
      const verdict = await judgeBullet(tasks.get(item.case)!, item.bullet, { log: false });
      if (!verdict.ok) throw new Error(verdict.message);
      const flagged = verdict.unsupported;
      kinds.push(flagged.length === 0 ? 'clean' : [...new Set(flagged.map((f) => f.kind))].join('+'));
      if (item.expect === 'clean') {
        tally.clean++;
        if (flagged.length > 0) tally.falseAlarms++;
      } else {
        tally.positives++;
        if (flagged.length > 0) tally.caught++;
        if (flagged.some((f) => f.kind === 'relationship')) tally.asRelationship++;
      }
    }
    console.log(`  [expect ${item.expect}] ${item.bullet}\n    → ${kinds.join(', ')}\n`);
  }

  console.log('Summary');
  console.log(`  false links caught (any flag)       ${tally.caught}/${tally.positives}`);
  console.log(`  …flagged as "relationship"           ${tally.asRelationship}/${tally.positives}`);
  console.log(`  correct bullets wrongly flagged      ${tally.falseAlarms}/${tally.clean}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
