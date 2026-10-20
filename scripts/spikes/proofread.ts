/**
 * SPIKE: scores the model proofreader on a resume with labeled errors, per error kind.
 * (The code spell checker and hybrid approaches it once compared were retired: DECISIONS 7.1.)
 *
 * The model runs at temperature 0, so repeated runs repeat exactly: one run is
 * the default, and more labeled resumes tell us more than more runs.
 *
 *   npm run spike:proofread                              fixtures/typos.labels.json
 *   npm run spike:proofread -- --fixture fixtures/private/proofread.labels.json
 *   npm run spike:proofread -- --show                    also print each flag (may contain resume text)
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { getEnv } from '@/lib/env';
import { gitInfo } from '@/lib/eval/git';
import { modelName, providerName } from '@/lib/llm';
import { loadLabeledResume } from '@/lib/proofread/labels';
import { runProofread } from '@/lib/proofread/model';
import { formatResultLine as line, summarizeFlags as summarize, type ProofreadResult as Result } from '@/lib/proofread/report';
import { loadLocalEnv, saveResults } from '../lib/run';

async function main(): Promise<void> {
  loadLocalEnv();
  const { values } = parseArgs({
    options: {
      fixture: { type: 'string', default: 'fixtures/typos.labels.json' },
      runs: { type: 'string', default: '1' },
      show: { type: 'boolean', default: false },
    },
  });
  const runs = Number(values.runs);
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

  for (let run = 1; run <= runs; run++) {
    const outcome = await runProofread(labeled.doc.text, { log: false });
    if (!outcome.ok) throw new Error(outcome.message);
    const flags = outcome.findings.map((f) => ({ word: f.word, context: f.quote }));
    const r = summarize('model', run, outcome.call.latencyMs, flags, labeled.items, outcome.findings.filter((f) => !f.evidenceFound).length);
    results.push(r);
    console.log(line(r));
    show(r);
  }

  const file = await saveResults(`proofread_${labeled.name}`, { meta: { provider: providerName(), model: modelName(), temperature: 0, runs, fixture: labeled.name, git }, results });
  console.log(`\nFull results: ${file}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
