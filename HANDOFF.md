# Handoff: where the project stands

Last updated 2026-10-20. Pair with `CLAUDE.md` (how to work here) and `DECISIONS.md` (why).

## Done

- **Phase 1: recruiter review.** Parser view, deterministic checks, streamed review with quote grounding, eval harness with rescoring. Baseline 59/60 checks, 122/122 quotes (the one failure: typo detection, ~37%, left for a proofreader reviewer).
- **Phase 2: job matching.** Requirement extraction and matching as a workflow (beat a tool-calling agent 25/25 vs 13/25). 132/132 extraction, 132/132 matching, 89/89 grounded quotes. Streamed item by item in the app.
- **Phase 2: bullet writer.** Evaluator–optimizer loop: up to 3 candidates from different angles, code checks, model judge, revisions, user picks. In the app from any "Partly" / "Not shown" requirement. User ratings: 0 rejected in the last two rounds.
- **Phase 2: grouped notes** (`1988884`, DECISIONS 6.13). The user separates unrelated work with a blank line; bullets stay within one group; the judge flags links across groups. Judge: links across groups caught 4/4; correct bullets wrongly flagged 1/6 (bar was 0/6). Bullets: 12/12 runs, 36/36 candidates passing, no final combines groups. Links *within* one group are not reliably judged; the interface line tells the user to check links.
- **Spikes save results with the commit.** `spike:bullets` and `spike:judge` write to `eval-results/` with the git commit and whether the tree was dirty (shared `gitInfo` in `src/lib/eval/git.ts`). `spike:judge` also saves each bullet's verdict and flags, and prints flag reasons.
- **Phase 3: three reviewers** (DECISIONS 7.1, 7.2). Recruiter, hiring manager and a model proofreader run one after another in one `/api/review` stream, shown as tabs with status marks; a failed reviewer shows its error on its own tab. Proofreader spike: non-words 9/9, real-word 9/13, casing 5/6, 0 false alarms on 20 trap terms, ~90 s (code spell checking was dropped). Hiring-manager eval 39/39, and it separates from the recruiter on `skills-not-shown` (verdict maybe vs yes, 3/3 each). Removing "typos" from the recruiter prompt changed nothing (49/51 before and after), and the typo expectation now lives with the proofreader.

- **Phase 5 prep: a recorded demo** (DECISIONS 7.6). `LLM_PROVIDER=replay` replays real model answers for four sample resumes through the real pipeline: sample picker, banner, `/api/review` taking a `sample`. `npm run demo:record` re-records (about 20 minutes, one run per sample). A test fails when a prompt change leaves a sample without a recording. Browser-checked locally. Not deployed.

## Refactor pass (done 2026-10-20)

Behavior-preserving cleanup, one commit per step; tests, typecheck and build stayed green, and `recordings.test.ts` never failed, so no prompt changed.

- **Dead code:** removed `encodeEvent`, `parseReview`, `reviewJsonSchema` and `schema.test.ts`; un-exported six helpers used only in their own file.
- **Script helpers:** `scripts/lib/run.ts` (`loadLocalEnv`, `saveResults`) replaces the copied env-loading and results-saving blocks. Saved file names and JSON are unchanged, so `--rescore` still works.
- **Retired:** `spike:tools` (DECISIONS 6.1 keeps the numbers), the proofreader's code and hybrid modes with `code.ts`, `alreadyFlagged` and `cspell-lib` (DECISIONS 7.1), and `anonymize`. All are in git history. `fixtures/private/anonymize.map.json` is still there.
- **Reviewed, not merged:** the stream hooks, the large components and the repeated test `CallRecord`. Nothing shrank enough to justify a change. If `ReviewWorkspace` keeps growing, pull the review tab's JSX into a `ReviewTab` component. `isWritingStyle` moved to `lib/bullets/request.ts`.
- **README:** layout tree, scripts table, Gemini schema note, demo wording and eval timing fixed. Left on purpose: the repeated install steps in Getting started and "Run it yourself", and the flow diagram, which omits `proofread_done` and the demo `sample` input.
- **Still true:** spikes are evidence (DECISIONS cites them by name), and bullet checks are frozen (CLAUDE.md rule 9).

**Still open:** choosing a host for the recorded demo (Phase 5).

## Next

- **Evaluation uses synthetic fixtures only** (decision, 2026-10-17): no real resume is used for evals or the proofreader check. `npm run eval` reads public fixtures only.
- **Hiring manager vs recruiter:** four more fixtures did not separate them (DECISIONS 7.3): the verdict did not follow the reviews' own issue list. A code cap is now in (`src/lib/review/verdict.ts`: a "yes" with a high-severity issue becomes "maybe", with a note in the panel). Scored on 54 saved runs it takes verdict checks from 47/54 to 51/54 with no regressions. Live full eval at `6843e6b`: recruiter 78/84, hiring manager 82/84, proofreader unchanged, no regressions; the cap fired only on hiring manager `wrong-specialty` (3 of 3). Remaining misses: the recruiter's verdict on `short-tenures` and `career-changer` ("yes" with no high issue). Cap note checked in the browser (looks fine). Hiring manager "listed skills not shown" on `skills-not-shown` is unstable (about half the runs; 3/5 at the earlier commit, 2/8 now), so don't read one miss as a regression. Ungrounded quotes were 5 of 380; watch.
- **Recruiter verdict misses:** `short-tenures` is fixed by a code fact (`tenureFacts`, DECISIONS 7.4): recruiter verdict "maybe" 3/3, recruiter 91/93 and hiring manager 93/93 (after one label fix) at `07cee5d`, with the new `student-internships` counter-fixture clean. Cost: ungrounded quotes rose to 18 of 412 (4.4%), 5 of them caused by the fact. The `short-tenures` fix is partial: about 3 of 5 runs say maybe or no (7.5 corrects 7.4). Still open: `career-changer` (recruiter "yes" with no engineering title, about 1 of 5 meets the label). A prompt line did not move it (DECISIONS 7.5, reverted), so the next step is a decision about the label, not another prompt change. Browser check of the cap note is done.
- **Proofreader in `npm run eval`:** plain `npm run eval` runs the recruiter, then the proofreader once per `fixtures/*.labels.json` (temperature 0, so one run). `--persona proofreader` runs it alone. Counts only are printed; flags are saved in `eval-results/`. No `--rescore` for it yet. **Baseline** (2026-10-19, three fixtures `typos`, `typos2`, `typos3`; commit `e37febe` for the first two, `6d6c567` for `typos3`): non-words 10/10, real-word 16/21 (`typos` 2/5, `typos2` 7/8, `typos3` 7/8), casing 5/6, traps flagged 0/33, no other false alarms, all quotes grounded. Compare any proofreader prompt change against this. Left as is (user decision): the four real-word misses ("to were", "Lead" for "Led", "uses" for "users", "of" for "off") share no clear pattern, and 21 labels are too few to tell a prompt change from noise, so add labeled cases before tuning.
- **Uncommitted at the time of writing:** `.claude/settings.json` (private-folder access, see CLAUDE.md) and `AGENTS.md` (written by `next dev`). Both belong in the next commit.
- **Hosting (Phase 5):** the demo build works locally with `LLM_PROVIDER=replay npm run dev`; the next step is choosing a host and deploying it (set `LLM_PROVIDER=replay` there; `.env.example` still needs the setting added by hand because the deny rule blocks it from me). Match and the bullet writer are not in the demo. After any prompt, persona or fact change, run `npm run demo:record` and commit `demo/recordings`.

## Open items

- Judge on links within one group: 1 catch, 2 misses, 1 false alarm (a correct two-step inference). One example each, so not fixing (DECISIONS 6.13).
- A revision can restate a flagged link with a number and pass, because each judge call starts fresh. If it repeats in the next spike, carry relationship flags forward.
- Verdicts can differ between runs of the same input (seen in the job-match headline). Product decision: lower temperature, majority vote, or show which verdicts are borderline.
- Job evals have no check against summary-as-evidence (review evals do).
- Number use in project bullets is intermittent (5 of 12 candidates used the notes' measured results; 5 of 9 in the grouped-notes run). Watching, not fixing.
- The model sometimes asks for facts the notes already contain (seen once).
- Hosted-model decision: settled for now as a recorded demo plus a self-host guide (DECISIONS 7.6). Bring-your-own-key or paid use waits for evidence of real users, and needs the evals rerun on that model.
- Git history (already on GitHub) still contains earlier company names in `HANDOFF.md` and two test files. Accepted for now (decision 2026-10-18); a history rewrite is the fix if that changes before the repo is linked publicly.

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
