/**
 * Replaces company names in fixtures/private/ (and any tracked files you list)
 * with placeholders. It prints counts only, never the names or the text around
 * them, so it is safe to run with output visible to anyone.
 *
 * 1. Create fixtures/private/anonymize.map.json (gitignored):
 *      { "replacements": { "Real Name": "CompanyA", "Other Name": "CompanyB" },
 *        "alsoFiles": ["HANDOFF.md"] }
 *    Use one-word placeholders: a lowercase match such as a domain becomes the
 *    lowercase placeholder ("name.com" → "companya.com").
 * 2. npm run anonymize            dry run: counts per file, nothing changed
 * 3. npm run anonymize -- --write apply
 *
 * Rewrites .txt, .json and .md files under fixtures/private/. PDFs can't be
 * edited as text and are listed so you can handle them yourself. Tracked files
 * that mention a name but aren't listed in alsoFiles are reported, not edited.
 */
import { execSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { AnonymizeMapSchema, mapProblems, replaceNames, totalCount } from '@/lib/eval/anonymize';

const ROOT = process.cwd();
const PRIVATE = path.join(ROOT, 'fixtures', 'private');
const MAP_FILE = path.join(PRIVATE, 'anonymize.map.json');
const TEXT = new Set(['.txt', '.json', '.md']);

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(ROOT, file);

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { write: { type: 'boolean', default: false } } });

  let map;
  try {
    map = AnonymizeMapSchema.parse(JSON.parse(await readFile(MAP_FILE, 'utf8')));
  } catch (err) {
    throw new Error(`Couldn't read ${rel(MAP_FILE)}: ${err instanceof z.ZodError ? z.prettifyError(err) : err instanceof Error ? err.message : err}`);
  }
  const problems = mapProblems(map);
  if (problems.length > 0) throw new Error(`Fix the mapping first:\n${problems.map((p) => `  ${p}`).join('\n')}`);

  const privateFiles = (await walk(PRIVATE)).filter((f) => f !== MAP_FILE);
  const targets = [
    ...privateFiles.filter((f) => TEXT.has(path.extname(f).toLowerCase())),
    ...map.alsoFiles.map((f) => path.resolve(ROOT, f)),
  ];
  const skipped = privateFiles.filter((f) => !TEXT.has(path.extname(f).toLowerCase()));

  const planned: { file: string; text: string; before: string; counts: Record<string, number> }[] = [];
  for (const file of targets) {
    const before = await readFile(file, 'utf8');
    const { text, counts } = replaceNames(before, map.replacements);
    if (file.endsWith('.json') && totalCount(counts) > 0) {
      try {
        JSON.parse(text);
      } catch {
        throw new Error(`Replacing in ${rel(file)} would make it invalid JSON. Nothing was written.`);
      }
    }
    planned.push({ file, text, before, counts });
  }

  console.log(values.write ? 'Applying replacements\n' : 'Dry run: nothing is changed. Add --write to apply.\n');
  for (const { file, counts } of planned) {
    console.log(`  ${String(totalCount(counts)).padStart(4)}  ${rel(file)}`);
  }
  const total = planned.reduce((n, p) => n + totalCount(p.counts), 0);
  console.log(`\n${total} replacement(s) in ${planned.filter((p) => totalCount(p.counts) > 0).length} of ${planned.length} file(s).`);

  const names = planned.reduce<Record<string, number>>((acc, p) => {
    for (const [name, n] of Object.entries(p.counts)) acc[name] = (acc[name] ?? 0) + n;
    return acc;
  }, {});
  const unused = Object.keys(map.replacements).filter((n) => !names[n]);
  if (unused.length > 0) console.log(`${unused.length} name(s) in the mapping matched nothing (check spelling).`);
  if (skipped.length > 0) console.log(`\nNot text, so not edited (handle by hand):\n${skipped.map((f) => `  ${rel(f)}`).join('\n')}`);

  // Names left in other tracked files: counts only, so you can add them to alsoFiles.
  const listed = new Set([...targets, MAP_FILE].map((f) => path.resolve(f)));
  const tracked = execSync('git ls-files -z', { cwd: ROOT }).toString().split('\0').filter(Boolean);
  const leaks: string[] = [];
  for (const file of tracked) {
    const full = path.resolve(ROOT, file);
    if (listed.has(full) || !TEXT.has(path.extname(file).toLowerCase()) && !/\.(ts|tsx|css|yml|yaml)$/.test(file)) continue;
    let content: string;
    try {
      content = await readFile(full, 'utf8');
    } catch {
      continue;
    }
    const n = totalCount(replaceNames(content, map.replacements).counts);
    if (n > 0) leaks.push(`  ${String(n).padStart(4)}  ${file}`);
  }
  if (leaks.length > 0) console.log(`\nTracked files that still mention a name (not in alsoFiles, so not edited):\n${leaks.join('\n')}`);

  if (values.write) {
    for (const p of planned) if (p.text !== p.before) await writeFile(p.file, p.text);
    console.log('\nDone. Re-run the checks that read these files (e.g. npm test) and review the diff of tracked files.');
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
