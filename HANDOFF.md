# Handoff: where the project stands

Last updated 2026-10-14. Pair with `CLAUDE.md` (how to work here) and `DECISIONS.md` (why).

## Done

- **Phase 1: recruiter review.** Parser view, deterministic checks, streamed review with quote grounding, eval harness with rescoring. Baseline 59/60 checks, 122/122 quotes (the one failure: typo detection, ~37%, left for a proofreader reviewer).
- **Phase 2: job matching.** Requirement extraction and matching as a workflow (beat a tool-calling agent 25/25 vs 13/25). 132/132 extraction, 132/132 matching, 89/89 grounded quotes. Streamed item by item in the app.
- **Phase 2: bullet writer.** Evaluator–optimizer loop: up to 3 candidates from different angles, code checks, model judge, revisions, user picks. In the app from any "Partly" / "Not shown" requirement. User ratings: 0 rejected in the last two rounds.
- **Phase 2: grouped notes** (`1988884`, DECISIONS 6.13). The user separates unrelated work with a blank line; bullets stay within one group; the judge flags links across groups. Judge: links across groups caught 4/4; correct bullets wrongly flagged 1/6 (bar was 0/6). Bullets: 12/12 runs, 36/36 candidates passing, no final combines groups. Links *within* one group are not reliably judged; the interface line tells the user to check links.
- **Spikes save results with the commit.** `spike:bullets` and `spike:judge` write to `eval-results/` with the git commit and whether the tree was dirty (shared `gitInfo` in `src/lib/eval/git.ts`). `spike:judge` also saves each bullet's verdict and flags, and prints flag reasons. `spike:tools` still saves nothing.

## Next: Phase 3, multiple reviewers

- Recruiter stays; add a hiring manager (technical depth, relevance) and a proofreader (spelling, consistency, formatting).
- **Decided (DECISIONS 7.1):** the proofreader is a model with the plain prompt (`src/lib/proofread/model.ts`); code spell checking added nothing. Still open: run it on the private resume (`npm run spike:proofread -- --fixture fixtures/private/proofread.labels.json`), then build the persona and the sequential streaming.
- Reviewers run one after another locally (~80 s each): stream each reviewer's results as soon as they're ready, same pattern as job matching.
- Eval impact: fixture expectations are written for one reviewer today; decide per-reviewer vs combined expectations before adding reviewers.

## Open items

- Judge on links within one group: 1 catch, 2 misses, 1 false alarm (a correct two-step inference). One example each, so not fixing (DECISIONS 6.13).
- A revision can restate a flagged link with a number and pass, because each judge call starts fresh. If it repeats in the next spike, carry relationship flags forward.
- Verdicts can differ between runs of the same input (seen in the job-match headline). Product decision: lower temperature, majority vote, or show which verdicts are borderline.
- Job evals have no check against summary-as-evidence (review evals do).
- Number use in project bullets is intermittent (5 of 12 candidates used the notes' measured results; 5 of 9 in the grouped-notes run). Watching, not fixing.
- The model sometimes asks for facts the notes already contain (seen once).
- `useReviewStream` still has its own copy of the logic in `useNdjsonRequest`.
- Hosted-model decision for a public demo (Phase 5): mock demo mode, bring-your-own-key, or paid with limits.

## Resume work (the actual goal)

- Project bullets drafted with the bullet writer; Lenovo #13 candidates usable. Re-run Chewy #19 with a note, in your own words, about building this with an AI assistant.
- Before linking the repo publicly, check nothing private is in git history (should print nothing):

  ```bash
  git log --all --name-only --format='' | grep -E 'fixtures/private|eval-results|\.env' | sort -u
  ```

- `DECISIONS.md` doubles as interview prep: each entry answers "why did you do it that way?"

## Starting the new chat

Suggested first message:

> I'm continuing the Resume Reviewer project. HANDOFF.md, CLAUDE.md, and DECISIONS.md are attached. I'm now also using Claude Code in the repo. First: [start Phase 3 | add labeled bullets for the within-group judge limit]. Keep the same working style: weigh options, pick one and explain why, set the success bar before each run.
