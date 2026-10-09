/**
 * Runs job matching on one resume and one posting, and prints the result.
 * For looking at real output before writing expectations; evals come next.
 *
 *   npm run match -- --resume fixtures/private/my-resume.pdf --job fixtures/private/jobs/job-1.txt
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { getEnv } from '@/lib/env';
import { loadResume } from '@/lib/eval/fixtures';
import { extractRequirements } from '@/lib/jobs/extract';
import { matchRequirements } from '@/lib/jobs/match';
import { TIERS, type MatchStatus } from '@/lib/jobs/schema';
import { modelName, providerName } from '@/lib/llm';

const MARK: Record<MatchStatus, string> = { met: '✓', partial: '~', missing: '✗' };

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Rely on the shell environment.
  }
  const { values } = parseArgs({ options: { resume: { type: 'string' }, job: { type: 'string' } } });
  if (!values.resume || !values.job) throw new Error('Usage: npm run match -- --resume <file> --job <file>');
  getEnv();

  const doc = await loadResume(values.resume);
  const posting = await readFile(values.job, 'utf8');
  console.log(`Matching with ${providerName()} / ${modelName()}\n`);

  process.stdout.write('Extracting requirements … ');
  const extracted = await extractRequirements(posting, { log: false });
  if (!extracted.ok) throw new Error(extracted.kind === 'aborted' ? 'Aborted.' : extracted.message);
  const requirements = extracted.data;
  const reworded = requirements.filter((r) => !r.foundInPosting);
  console.log(
    `${requirements.length} found in ${(extracted.call.latencyMs / 1000).toFixed(1)} s` +
      (reworded.length > 0 ? `, ${reworded.length} not word for word from the posting` : ''),
  );

  process.stdout.write('Matching against the resume … ');
  const matched = await matchRequirements(doc, requirements, { log: false });
  if (!matched.ok) throw new Error(matched.kind === 'aborted' ? 'Aborted.' : matched.message);
  const report = matched.data;
  console.log(`done in ${(matched.call.latencyMs / 1000).toFixed(1)} s\n`);

  for (const tier of TIERS) {
    const inTier = report.matches.filter((m) => m.tier === tier);
    if (inTier.length === 0) continue;
    const c = report.counts[tier];
    console.log(`${tier.toUpperCase()}  (met ${c.met}, partial ${c.partial}, missing ${c.missing})`);
    for (const m of inTier) {
      const flags = [!m.foundInPosting ? 'reworded from posting' : '', !m.evidenceFound ? 'quote not in resume' : '']
        .filter(Boolean)
        .join('; ');
      console.log(`  ${MARK[m.status]} ${String(m.id).padStart(2)}. ${m.text}${flags ? `  [${flags}]` : ''}`);
      if (m.evidence) console.log(`        evidence: "${m.evidence}"`);
      if (m.gap) console.log(`        gap: ${m.gap}`);
    }
    console.log('');
  }

  if (report.unanswered.length > 0) console.log(`Not answered by the model: ${report.unanswered.join(', ')}\n`);
  const quotes = report.matches.filter((m) => m.evidence);
  console.log(`Evidence found in resume: ${quotes.filter((m) => m.evidenceFound).length}/${quotes.length}`);
  console.log(`Total time: ${((extracted.call.latencyMs + matched.call.latencyMs) / 1000).toFixed(1)} s`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
