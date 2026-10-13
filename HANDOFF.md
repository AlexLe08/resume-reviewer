# Handoff: where the project stands

Last updated 2026-10-13. Pair with `CLAUDE.md` (how to work here) and `DECISIONS.md` (why).

## Done

- **Phase 1: recruiter review.** Parser view, deterministic checks, streamed review with quote grounding, eval harness with rescoring. Baseline 59/60 checks, 122/122 quotes (the one failure: typo detection, ~37%, left for a proofreader reviewer).
- **Phase 2: job matching.** Requirement extraction and matching as a workflow (beat a tool-calling agent 25/25 vs 13/25). 132/132 extraction, 132/132 matching, 89/89 grounded quotes. Streamed item by item in the app.
- **Phase 2: bullet writer.** Evaluator–optimizer loop: up to 3 candidates from different angles, code checks, model judge, revisions, user picks. In the app from any "Partly" / "Not shown" requirement. User ratings: 0 rejected in the last two rounds.

## In progress: grouped notes (code written, not yet tested against the model)

**Why:** the judge caught only 1 of 3 kinds of false link between facts (it misses "to improve X" / "to ensure Y" phrasing). Notes list facts, not how they relate, so the model guesses. Now the user groups notes (a blank line between unrelated work); the drafter keeps each bullet within one group, and the judge treats any link across groups as unsupported.

**Status:** the change is in `resume-reviewer-note-groups.zip` (10 files: loop, request, fixture loader, BulletWriter, spikes, tests, grouped `project-ai` case, 11 judge labels). Apply it, then `npm run typecheck && npm test`, and commit.

**Next runs** (the judge's instructions changed, so both are needed):

```bash
caffeinate -i npm run spike:judge      # ~11 calls, a few minutes
caffeinate -i npm run spike:bullets    # ~35 minutes
```

**Success bar (set before running):**

- False links between groups: caught 4 of 4.
- Correct bullets wrongly flagged: 0 of 6, including two that combine facts within one group.
- The within-group false link ("comparing a tool-calling agent… to ensure accurate extraction"): recorded either way. Predicted to be missed; grouping can't help it. The interface line under candidates covers it.
- In `spike:bullets`: no project-ai final candidate combines groups; "passing with a source number" keeps the baseline (5 of 12 so far).

Record the result as DECISIONS 6.13.

## Next: Phase 3, multiple reviewers

- Recruiter stays; add a hiring manager (technical depth, relevance) and a proofreader (spelling, consistency, formatting).
- **First decision:** is the proofreader a model at all? Test a code spell checker (plus a technology wordlist) against the model on `weak-duties` and the private resume. The spell checker's risk is false alarms on names like Puppeteer and Akamai.
- Reviewers run one after another locally (~80 s each): stream each reviewer's results as soon as they're ready, same pattern as job matching.
- Eval impact: fixture expectations are written for one reviewer today; decide per-reviewer vs combined expectations before adding reviewers.

## Open items

- Verdicts can differ between runs of the same input (seen in the job-match headline). Product decision: lower temperature, majority vote, or show which verdicts are borderline.
- Job evals have no check against summary-as-evidence (review evals do).
- Number use in project bullets is intermittent (5 of 12 candidates used the notes' measured results). Watching, not fixing.
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

> I'm continuing the Resume Reviewer project. HANDOFF.md, CLAUDE.md, and DECISIONS.md are attached. I'm now also using Claude Code in the repo. First: [apply/test the grouped-notes change | review the spike:judge results below | start Phase 3]. Keep the same working style: weigh options, pick one and explain why, set the success bar before each run.
