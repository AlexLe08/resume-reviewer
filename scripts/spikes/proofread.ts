/**
 * SPIKE: is the proofreader a model? Runs a code spell checker (cspell with
 * software-terms and companies dictionaries, no project wordlist) and a model
 * proofreader on resumes with labeled errors, and scores both per error kind.
 *
 * The model runs at temperature 0, so repeated runs repeat exactly: one run is
 * the default, and more labeled resumes tell us more than more runs.
 *
 *   npm run spike:proofread                              fixtures/typos.labels.json, both approaches
 *   npm run spike:proofread -- --fixture fixtures/private/proofread.labels.json
 *   npm run spike:proofread -- --only code|model|hybrid  one approach (hybrid also runs code first)
 *   npm run spike:proofread -- --show                    also print each flag (may contain resume text)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { getEnv } from '@/lib/env';
import { gitInfo } from '@/lib/eval/git';
import { modelName, providerName } from '@/lib/llm';
import { checkSpelling } from '@/lib/proofread/code';
import { loadLabeledResume, type LabelItem } from '@/lib/proofread/labels';
import { runProofread } from '@/lib/proofread/model';
import { countByKind, scoreFlags, type Flag, type KindCounts, type Scored } from '@/lib/proofread/score';

interface Result {
  approach: 'code' | 'model' | 'both' | 'hybrid';
  run: number;
  latencyMs: number;
  kinds: KindCounts;
  trapsFlagged: number;
  trapsTotal: number;
  unlabeled: number;
  arguable: number;
  /** Model only: findings whose quote isn't in the resume. */
  ungrounded: number;
  flags: Flag[];
  scored: { caught: string[]; trapFlags: unknown[]; unlabeled: Flag[]; arguable: unknown[] };
}

function summarize(approach: Result['approach'], run: number, latencyMs: number, flags: Flag[], labels: LabelItem[], ungrounded = 0): Result {
  const scored: Scored = scoreFlags(flags, labels);
  return {
    approach,
    run,
    latencyMs,
    kinds: countByKind(scored, labels),
    trapsFlagged: new Set(scored.trapFlags.map((t) => t.labelId)).size,
    trapsTotal: labels.filter((l) => l.kind === 'trap').length,
    unlabeled: scored.unlabeled.length,
    arguable: scored.arguable.length,
    ungrounded,
    flags,
    scored: { caught: [...scored.caught], trapFlags: scored.trapFlags, unlabeled: scored.unlabeled, arguable: scored.arguable },
  };
}

function line(r: Result): string {
  const k = r.kinds;
  const frac = (c: { caught: number; total: number }) => (c.total === 0 ? '  -  ' : `${c.caught}/${c.total}`.padStart(5));
  return (
    `  ${r.approach.padEnd(6)} nonword ${frac(k.nonword)}  realword ${frac(k.realword)}  casing ${frac(k['tech-casing'])}  ` +
    `traps flagged ${r.trapsFlagged}/${r.trapsTotal}  other false alarms ${r.unlabeled}  style calls ${r.arguable}` +
    (r.approach === 'model' || r.approach === 'hybrid' ? `  ungrounded ${r.ungrounded}` : '') +
    `  ${r.latencyMs} ms`
  );
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Rely on the shell environment.
  }
  const { values } = parseArgs({
    options: {
      fixture: { type: 'string', default: 'fixtures/typos.labels.json' },
      only: { type: 'string' },
      runs: { type: 'string', default: '1' },
      show: { type: 'boolean', default: false },
    },
  });
  const runs = Number(values.runs);
  const only = values.only;
  if (only !== undefined && only !== 'code' && only !== 'model' && only !== 'hybrid') throw new Error('--only takes "code", "model" or "hybrid".');
  getEnv();

  const labeled = await loadLabeledResume(path.resolve(values.fixture));
  const git = gitInfo();
  const kinds = labeled.items.reduce<Record<string, number>>((n, i) => ({ ...n, [i.kind]: (n[i.kind] ?? 0) + 1 }), {});
  console.log(
    `Proofread spike: ${labeled.name} (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')})\n` +
      `model: ${providerName()} / ${modelName()}, temperature 0, ${runs} run(s)\n` +
      `commit: ${git.commit ?? 'unknown'}${git.dirty ? ' (uncommitted changes)' : ''}\n`,
  );

  const results: Result[] = [];
  const show = (r: Result) => {
    if (!values.show) return;
    for (const f of r.flags) console.log(`      "${f.word}" in "${f.context.replace(/\s+/g, ' ')}"`);
  };

  let codeFlags: Flag[] = [];
  let codeLatency: number | undefined;
  if (only !== 'model') {  // code also feeds the hybrid
    const started = performance.now();
    const issues = await checkSpelling(labeled.doc.text);
    codeFlags = issues.map((i) => ({ word: i.word, context: i.context }));
    codeLatency = Math.round(performance.now() - started);
    const r = summarize('code', 1, codeLatency, codeFlags, labeled.items);
    if (only !== 'hybrid') {
      results.push(r);
      console.log(line(r));
      show(r);
    }
  }

  if (only === undefined || only === 'model') {
    for (let run = 1; run <= runs; run++) {
      const outcome = await runProofread(labeled.doc.text, { log: false });
      if (!outcome.ok) throw new Error(outcome.message);
      const flags = outcome.findings.map((f) => ({ word: f.word, context: f.quote }));
      const r = summarize('model', run, outcome.call.latencyMs, flags, labeled.items, outcome.findings.filter((f) => !f.evidenceFound).length);
      results.push(r);
      console.log(line(r));
      show(r);
      // Combining the two: does the model add what code can't see?
      if (only === undefined) {
        const both = summarize('both', run, r.latencyMs, [...codeFlags, ...flags], labeled.items);
        results.push(both);
        console.log(line(both));
      }
    }
  }

  if (only === undefined || only === 'hybrid') {
    // The change under test: the model sees what code flagged and looks only for real-word and casing errors.
    for (let run = 1; run <= runs; run++) {
      const outcome = await runProofread(labeled.doc.text, { log: false, alreadyFlagged: codeFlags.map((f) => f.word) });
      if (!outcome.ok) throw new Error(outcome.message);
      const flags = outcome.findings.map((f) => ({ word: f.word, context: f.quote }));
      // Code's flags plus the model's, scored together: what a user would see.
      const r = summarize('hybrid', run, outcome.call.latencyMs + (codeLatency ?? 0), [...codeFlags, ...flags], labeled.items, outcome.findings.filter((f) => !f.evidenceFound).length);
      results.push(r);
      console.log(line(r));
      if (values.show) for (const f of flags) console.log(`      model: "${f.word}" in "${f.context.replace(/\s+/g, ' ')}"`);
    }
  }

  const outDir = path.join(process.cwd(), 'eval-results');
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}_proofread_${labeled.name}_${providerName()}_${modelName().replace(/[^a-z0-9.-]/gi, '_')}.json`);
  await writeFile(file, JSON.stringify({ meta: { provider: providerName(), model: modelName(), temperature: 0, runs, fixture: labeled.name, git }, results }, null, 2));
  console.log(`\nFull results: ${path.relative(process.cwd(), file)}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
