# Handoff: where the project stands

Last updated 2026-10-17. Pair with `CLAUDE.md` (how to work here) and `DECISIONS.md` (why).

## Done

- **Phase 1: recruiter review.** Parser view, deterministic checks, streamed review with quote grounding, eval harness with rescoring. Baseline 59/60 checks, 122/122 quotes (the one failure: typo detection, ~37%, left for a proofreader reviewer).
- **Phase 2: job matching.** Requirement extraction and matching as a workflow (beat a tool-calling agent 25/25 vs 13/25). 132/132 extraction, 132/132 matching, 89/89 grounded quotes. Streamed item by item in the app.
- **Phase 2: bullet writer.** Evaluator–optimizer loop: up to 3 candidates from different angles, code checks, model judge, revisions, user picks. In the app from any "Partly" / "Not shown" requirement. User ratings: 0 rejected in the last two rounds.
- **Phase 2: grouped notes** (`1988884`, DECISIONS 6.13). The user separates unrelated work with a blank line; bullets stay within one group; the judge flags links across groups. Judge: links across groups caught 4/4; correct bullets wrongly flagged 1/6 (bar was 0/6). Bullets: 12/12 runs, 36/36 candidates passing, no final combines groups. Links *within* one group are not reliably judged; the interface line tells the user to check links.
- **Spikes save results with the commit.** `spike:bullets` and `spike:judge` write to `eval-results/` with the git commit and whether the tree was dirty (shared `gitInfo` in `src/lib/eval/git.ts`). `spike:judge` also saves each bullet's verdict and flags, and prints flag reasons. `spike:tools` still saves nothing.
- **Phase 3: three reviewers** (DECISIONS 7.1, 7.2). Recruiter, hiring manager and a model proofreader run one after another in one `/api/review` stream, shown as tabs with status marks; a failed reviewer shows its error on its own tab. Proofreader spike: non-words 9/9, real-word 9/13, casing 5/6, 0 false alarms on 20 trap terms, ~90 s (code spell checking was dropped). Hiring-manager eval 39/39, and it separates from the recruiter on `skills-not-shown` (verdict maybe vs yes, 3/3 each). Removing "typos" from the recruiter prompt changed nothing (49/51 before and after), and the typo expectation now lives with the proofreader.

## Next

- **Evaluation uses synthetic fixtures only** (decision, 2026-10-17): no real resume is used for evals or the proofreader check. `npm run eval` still tries any fixture in `fixtures/private/`, and one points at a PDF that is missing, so run it with `--only` and the public fixture names, or remove that fixture.
- **More fixtures where the hiring manager and recruiter should differ.** `skills-not-shown` split them on verdict (hiring manager "maybe" 3/3, recruiter "yes" 3/3), but it is one fixture. Labels for new fixtures are the user's call.
- **Proofreader in the eval harness:** it is scored by `spike:proofread` on `*.labels.json` only, not by `npm run eval`. Decide whether it should be a regular eval or stay a spike.
- **Hosting (Phase 5):** a full review is ~4-5 min locally; the route's `maxDuration = 60` would cut it short on a host.

## Open items

- Judge on links within one group: 1 catch, 2 misses, 1 false alarm (a correct two-step inference). One example each, so not fixing (DECISIONS 6.13).
- A revision can restate a flagged link with a number and pass, because each judge call starts fresh. If it repeats in the next spike, carry relationship flags forward.
- Verdicts can differ between runs of the same input (seen in the job-match headline). Product decision: lower temperature, majority vote, or show which verdicts are borderline.
- Job evals have no check against summary-as-evidence (review evals do).
- Number use in project bullets is intermittent (5 of 12 candidates used the notes' measured results; 5 of 9 in the grouped-notes run). Watching, not fixing.
- The model sometimes asks for facts the notes already contain (seen once).
- Hosted-model decision for a public demo (Phase 5): mock demo mode, bring-your-own-key, or paid with limits.

## Resume work (the actual goal)

- Project bullets drafted with the bullet writer; CompanyC #13 candidates usable. Re-run CompanyA #19 with a note, in your own words, about building this with an AI assistant.
- Before linking the repo publicly, check nothing private is in git history (should print nothing):

  ```bash
  git log --all --name-only --format='' | grep -E 'fixtures/private|eval-results|\.env' | sort -u
  ```

- `DECISIONS.md` doubles as interview prep: each entry answers "why did you do it that way?"

## Starting the new chat

Suggested first message:

> I'm continuing the Resume Reviewer project. HANDOFF.md, CLAUDE.md, and DECISIONS.md are attached. I'm now also using Claude Code in the repo. First: [start Phase 3 | add labeled bullets for the within-group judge limit]. Keep the same working style: weigh options, pick one and explain why, set the success bar before each run.
