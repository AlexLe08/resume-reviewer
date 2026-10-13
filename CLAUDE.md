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
| `npm run eval`                                                               | Review evals: fixtures × runs, results in `eval-results/` with the git commit                                          |
| `npm run eval -- --rescore <file>`                                           | Re-apply current expectations to saved results, no model calls                                                         |
| `npm run eval:jobs -- --stage extract\|match\|both`                          | Job-matching evals; also `--only`, `--runs`, `--rescore`                                                               |
| `npm run match -- --resume <pdf> --job <txt>`                                | One job match in the terminal                                                                                          |
| `npm run spike:bullets` / `npm run spike:judge` / `npm run spike:tools`      | Bullet-loop, judge and tool-use spikes                                                                                 |
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
src/lib/review/       recruiter review: prompt, schema, grounding (quote checking), runReview()
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
fixtures/             public fixtures; fixtures/private/ is gitignored (real resume, postings, notes)
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

- `.claude/settings.json` denies Read on `fixtures/private/`, `eval-results/` and `.env*`. Don't ask the user to paste content from them: work from public fixtures, or ask the user to add a synthetic fixture that reproduces the issue. Ask before running a script on private fixtures, since its output may contain resume text.
- Never commit or print resume content, notes, postings, or `eval-results/`. `DECISIONS.md` must contain no personal details.
- Notes are used per request and never stored. Only writing-style settings persist (browser `localStorage`).
- No-spend: development must cost nothing.

## Working agreement

- The user is a mid-level frontend developer learning LLM/agent engineering. Explain the options and tradeoffs before larger changes, and say why the chosen one wins.
- The user reviews every diff. Stage by name, check `git diff --staged`, then commit. Don't use `git commit -am`.
- Don't edit files in `fixtures/private/` without asking: they are the user's ground truth.
- The user is the ground truth for labels and for whether a bullet is accurate.
- TypeScript strict (`noUncheckedIndexedAccess`, `allowUnreachableCode: false`). Comments explain why, not what. User-facing copy is plain language.
