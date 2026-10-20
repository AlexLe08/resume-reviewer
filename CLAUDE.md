# CLAUDE.md

Context for AI coding sessions in this repo. Read this first, then `HANDOFF.md` for current status and `DECISIONS.md` for why things are the way they are.

## What this is

Resume Reviewer: a Next.js + TypeScript app that shows what a parser extracts from a resume, reviews it as a recruiter would, matches it against a job posting, and helps write honest resume bullets from the user's own notes. It is both a portfolio project (demonstrating LLM/agent engineering with measured evals) and a product meant to find real users.

## Commands

| Command                                                                      | What it does                                                                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                                                | Dev server. Restart after editing `.env.local` (settings are cached)                                                   |
| `npm test` / `npm run typecheck`                                             | Vitest / `tsc --noEmit`. Both must pass before a commit                                                                |
| `npx vitest run src/lib/bullets/checks.test.ts` / `npx vitest run -t "name"` | One test file / tests matching a name. Tests are colocated as `src/**/*.test.ts`, node environment, `@` aliases `src/` |
| `npm run build`                                                              | Next production build (there is no lint script)                                                                        |
| `npm run eval` / `npm run eval -- --persona hiring-manager\|proofreader`     | Recruiter evals then the proofreader on `fixtures/*.labels.json` / one persona (only fixtures that list it) / the proofreader alone; public fixtures only; results in `eval-results/` with the git commit |
| `npm run eval -- --rescore <file>`                                           | Re-apply current expectations to saved results, no model calls                                                         |
| `npm run eval:jobs -- --stage extract\|match\|both`                          | Job-matching evals; also `--only`, `--runs`, `--rescore`                                                               |
| `npm run match -- --resume <pdf> --job <txt>`                                | One job match in the terminal                                                                                          |
| `npm run spike:bullets` / `npm run spike:judge`                              | Bullet-loop and judge spikes                                                                                           |
| `npm run spike:proofread -- --fixture <labels> --show` | Proofreader scored on a `*.labels.json` file; `--show` prints flags (may contain resume text)                  |
| `npm run anonymize` / `npm run anonymize -- --write`                         | Replace names in `fixtures/private/` and listed tracked files from `fixtures/private/anonymize.map.json`; dry run by default, prints counts only |
| `npm run demo:record` / `-- --only <sample>` | Record real model answers for the demo's four samples into `demo/recordings` (about 20 minutes; a full run clears the folder first). Needed after any prompt, persona, fact, schema or sample change |
| `LLM_PROVIDER=replay npm run dev` | The hosted demo build: replays the recordings, no model, only the samples have reviews |
| `LLM_PROVIDER=mock npm run …`                                                | Instant, no model: for UI work and checking plumbing                                                                   |

Long runs: prefix with `caffeinate -i` (a sleeping Mac stalled a run for 19 minutes). Evals and spikes take 10–40 minutes on the local model: **ask before starting one**.

## Environment

- Default provider: Ollama, model `gemma4:e4b-it-q4_K_M`. Use **GGUF** tags: Homebrew's Ollama returns HTTP 501 for structured output on MLX tags.
- 16 GB Mac mini: stop Colima / Docker Desktop / OrbStack during model runs. Ollama runs natively, one request at a time.
- Gemini (`LLM_PROVIDER=gemini`) is for comparisons only; its free tier may use submitted content.

## Architecture

```
src/lib/llm/          provider boundary (ollama, gemini, mock), retry, usage; callStructured() = every model call
src/lib/checks/       deterministic resume checks, timeline (dates computed in code)
src/lib/review/       personas (recruiter, hiring manager), prompt, schema, grounding (quote checking), runReview(); reviewers.ts = the ordered Reviewer list and runReviewers()
src/lib/demo/         demo samples (catalog.ts is pure so the browser can use it) and DEMO_TODAY; recordings live in demo/recordings
src/lib/proofread/    proofreader: model call (model.ts), labels format + validation, scoring
src/lib/jobs/         requirement extraction + matching (a workflow, not an agent: see DECISIONS §6.2)
src/lib/bullets/      evaluator–optimizer loop: checks.ts (code checks), loop.ts (draft → check → judge → revise)
src/lib/pdf/          PDF text extraction (unpdf)
src/lib/http/         shared route helpers; src/lib/env.ts reads settings
src/lib/stream/       NDJSON event types per stream, streaming JSON array-item reader
src/lib/eval/         fixtures, assertions, reports for review and job evals
src/app/api/          review, match, bullets routes (all stream NDJSON)
src/hooks/            useNdjsonRequest + one hook per stream; reducers are pure and tested
src/components/       ReviewWorkspace (tabs), MatchPanel/MatchResults, BulletWriter
scripts/              eval runners, match CLI, spikes/
fixtures/             public fixtures (*.eval.json for reviews, *.labels.json for the proofreader); fixtures/private/ is gitignored
```

## Principles (each came from a measured failure; see DECISIONS.md)

- **Code computes, the model judges.** If code can work it out (dates, years of experience, grounding), code does, and the prompt states the result as a fact. When code supplies the answer, code also supplies the evidence.
- **Nothing invented.** Quotes are checked against source text in code. Bullets may use only the bullet and the user's notes; the target requirement is never a source of facts.
- **Untrusted text** (resumes, postings) goes inside tags, stripped of look-alike tags.
- **All model calls go through `callStructured`**; app code never imports a provider directly.
- **Streamed items and final results use the same code path**, so they can't disagree.
- **Safety by code, quality by the user's choice**: the bullet loop offers several candidates that all pass; the user picks.

## Evaluation discipline

1. Write the success bar **before** a run.
2. **One change at a time.** Two changes in one run make attribution impossible.
3. A change to a **shared prompt** needs a full run, not just the targeted fixtures.
4. Before hunting a regression's cause, **confirm it** at the previous commit with 5 runs.
5. **Read failing outputs** before acting: checks fail in both directions.
6. **Validate a check against labeled data or user ratings** before enforcing it.
7. Temperature-0 judge calls repeat exactly: add **more labeled examples**, not more runs.
8. Commit before eval runs, so results record a clean commit.
9. **Bullet checks are frozen.** A new heuristic needs a failure seen across new bullets, not one fixture.
10. Changing an expected answer needs a rule from the requirement's wording ("or" = any one, "and" = all), applied to every requirement, verified with `--rescore`.

## Privacy and constraints

- `.claude/settings.json` denies Read on `.env*`, and allows Read on `eval-results/` (opened 2026-10-19 to read failing reviews of synthetic fixtures) and Read/Edit on `fixtures/private/` (opened 2026-10-17 to anonymize company names). Older files there may hold text from the user's real resume (runs before the synthetic-only decision): read only results you just produced from public fixtures, and ask before opening any other file. **Evaluation uses synthetic public fixtures only** (user decision): don't run evals or spikes on private fixtures, and open them only when the user asks. If a problem needs a real-world case, ask for a synthetic fixture that reproduces it.
- The demo's recordings (`demo/recordings`) are committed and may contain model text about the public sample resumes only; `demo:record` refuses anything but a plain file name in `fixtures/`.
- Never commit or print resume content, notes, postings, or `eval-results/`. `DECISIONS.md` and `HANDOFF.md` must contain no personal details or real company names (use placeholders such as `CompanyA`; test fixtures too). Git history before 2026-10-18 still has some; accepted.
- Notes are used per request and never stored. Only writing-style settings persist (browser `localStorage`).
- No-spend: development must cost nothing.

## Working agreement

- The user is a mid-level frontend developer learning LLM/agent engineering. Explain the options and tradeoffs before larger changes, and say why the chosen one wins.
- The user reviews every diff. Stage by name, check `git diff --staged`, then commit. Don't use `git commit -am`.
- Don't edit files in `fixtures/private/` without asking: they are the user's ground truth.
- A new reviewer = a `Reviewer` entry in `src/lib/review/reviewers.ts` (a persona in `personas.ts` if it returns a verdict, its own pipeline and event if not) plus fixtures that list it under `reviewers` in `*.eval.json`.
- Changing a persona, a computed fact, the review schema or a sample resume breaks `src/lib/demo/recordings.test.ts` on purpose: run `npm run demo:record` and commit `demo/recordings` with the change.
- `AGENTS.md` is written by `next dev`; commit it with the work rather than leaving it as noise.
- The user is the ground truth for labels and for whether a bullet is accurate.
- TypeScript strict (`noUncheckedIndexedAccess`, `allowUnreachableCode: false`). Comments explain why, not what. User-facing copy is plain language.
