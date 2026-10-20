# Decision log

What we decided, why, what we rejected, and the evidence. Newest experiments at the bottom of each section.

**Conventions**

- Rates are passes / runs, e.g. `3/5`. With 3–5 runs per fixture, a one-run difference is noise.
- Commits refer to this repo. Eval results files (gitignored) record the commit and whether the tree was dirty.
- Model for all eval numbers unless noted: `gemma4:e4b-it-q4_K_M` on Ollama, recruiter persona.

---

## 1. Product direction

### 1.1 Resume reviewer, reframed away from "emulate specific ATS vendors"

- **Decision:** Build a resume reviewer with (1) deterministic parsing checks showing what a parser actually extracts, (2) job-description matching, and (3) multiple reviewer personas.
- **Rejected:** Having the model "act like Workday / Taleo / Greenhouse." There is no free access to these systems and no ground truth to emulate, so the feedback would be confident and invented.
- **Why:** Recruiter surveys indicate ATS rarely auto-reject on resume content; the real filters are knockout questions on application forms. What *is* real and testable is parsing quality and keyword search. Honesty about this is also the product's differentiator in a crowded space.

### 1.2 No-spend constraint

- **Decision:** Development must cost nothing. Local models (Ollama) by default; Gemini free tier for comparison only.
- **Consequence:** Free to *build*, not free to *run* for real users. The hosted product's model access (paid tier with limits, bring-your-own-key, or in-browser) is deferred to Phase 5.

### 1.3 Privacy

- Resumes are processed in memory, never written to disk or logs. Usage logs contain token counts and timing only.
- Real resumes live in `fixtures/private/` (gitignored). Eval output quotes resume text, so `eval-results/` is gitignored too.
- Gemini's free tier may use submitted content to improve Google's products, so it is only used with the author's own or synthetic resumes.

---

## 2. Architecture and stack

### 2.1 TypeScript, one Next.js app

- **Decision:** TypeScript end to end; a single Next.js app with API routes.
- **Rejected:** Python backend (richer ML ecosystem, but we call models rather than train them); separate Vite frontend + Express API (more deploy and CORS overhead without teaching anything agent-related).

### 2.2 Raw SDKs behind our own boundary, no framework

- **Decision:** Call provider APIs directly. All app code imports `@/lib/llm`; only provider files know which provider is in use.
- **Rejected:** LangChain/LangGraph-style frameworks for now. They hide the mechanics being learned and change quickly. A thin abstraction (e.g. the Vercel AI SDK) can be adopted later, once its job is understood.

### 2.3 Streaming protocol: NDJSON over `fetch`

- **Rejected:** Server-Sent Events (the browser `EventSource` API only supports GET, and we upload a file); WebSockets (two-way and stateful, more than a one-way stream needs).
- Event types are defined once in `lib/stream/events.ts` and shared by server and client.

### 2.4 Structured output, validated

- One Zod schema becomes the JSON Schema sent to the model *and* validates the response. "The API promised" is not the same as "we checked."
- Every finding must quote the resume (`evidence`). No 1–10 score: LLM scores are poorly calibrated; a yes/maybe/no verdict plus specific findings is more honest.

### 2.5 Deterministic code before the LLM

- Anything code can check, code checks: selectable text, contact info, standard sections, length, employment timeline, quote grounding. Free, instant, repeatable.

### 2.6 Resume text is untrusted

- Wrapped in `<resume>` tags with look-alike tags stripped; the model is told to report embedded instructions as a red flag rather than follow them. Verified by the `prompt-injection` fixture (3/3 reported at high severity, never obeyed).

---

## 3. Model providers

### 3.1 Provider registry: `ollama` (default) | `gemini` | `mock`

- **Why Ollama by default:** The Gemini free tier hit rate limits and multi-minute 503 outages during development. Local means no limits, no outages, and real resumes never leave the machine.
- **Why not Ollama for hosted users:** It would need GPU hosting (costs money) or users installing a model runtime (unrealistic for job seekers). Ollama remains the story for self-hosting.
- **Mock provider:** Streams a canned review built from the real resume text (plus one deliberately invented quote), for UI work and for testing the eval runner itself.

### 3.2 Hardware constraints

- 16 GB Mac mini, with up to 4 GB taken by a container VM when one is running. Budget ~6–8 GB for the model, so ~8B parameters at 4-bit quantization. Do not run Colima / Docker Desktop / OrbStack during local reviews.
- Run Ollama natively, not in Docker (containers on macOS cannot use the Apple Silicon GPU).

### 3.3 Use GGUF model tags, not MLX

- Homebrew's Ollama build lacks the library needed for structured output with MLX models and returns `HTTP 501 structured output is unavailable`. GGUF tags (e.g. `gemma4:e4b-it-q4_K_M`) work. The 501 now produces an actionable error message.

### 3.4 Retries

- Retry only before the first streamed chunk (a later retry would mix two responses), only on 500/502/503/504, up to 3 attempts with exponential backoff and jitter.
- Not retried: 429 (free-tier quota; immediate retry fails again), 400 (fails identically), unreachable Ollama (won't start itself).
- **Model fallback deferred:** Falling back to a different model silently changes output quality; only acceptable once evals can judge the fallback model.

### 3.5 Log what actually happened

- Usage logs record the model the provider *reports* serving the request, not just the one we asked for.

---

## 4. Evaluation methodology

### 4.1 Evals run the real pipeline

- `runReview()` is shared by the API route and the eval runner, so a passing eval says something about production.
- Evals are a CLI script (`npm run eval`), separate from unit tests: they take ~25 minutes and measure rates, not pass/fail.

### 4.2 Checks are deterministic keyword rules (for now)

- `verdictIn`, `mustMention` (optionally `minSeverity`), `mustNotMention` (reviewer text only, not quotes), `strengthEvidenceNotIn`.
- **Known limit:** keywords catch "never mentioned" reliably, not "mentioned badly." A model-as-judge comes later and needs its own evaluation.

### 4.3 Guards on the eval itself

- Every check is shown to both pass and fail before its passes are trusted (the mock provider makes most checks fail on purpose).
- Fixtures are validated before any model call, including private ones (`validateFixture`). A broken fixture previously produced a check that could never fail.
- `--rescore <results.json>` re-applies current expectations to saved reviews without calling a model. Any change to a check is verified by rescoring past results and confirming every flip is intended.

### 4.4 Rules learned the hard way

1. **Confirm a drop is real before hunting its cause.** Rerun the previous commit with 5 runs first.
2. **Change one thing at a time.** Two changes in one run make attribution impossible.
3. **A rule added to the shared prompt affects every fixture.** Follow it with a full run, not just the targeted fixtures.
4. **Read failing reviews before acting.** Checks fail in both directions (see 5.8).
5. **Write predictions and success bars down before the run.**
6. Use `--runs 5` for fixtures under active change; `caffeinate -i` for long runs (a sleeping Mac stalled one run for 19 minutes); report median, not mean, latency.

7. **Changing an expected answer needs a rule taken from the requirement's wording** ("or" = any one is enough, "and" = all), applied to every requirement, and verified by rescoring. Otherwise it's moving the goalposts.
8. **A temperature-0 judge repeats its answers exactly.** Repeated runs aren't independent samples: measure with more labeled examples, not more runs.
9. **Check against human ratings before enforcing a quality check.** Two plausible checks (coverage, keep-the-terms) contradicted the user's ratings and were never enforced.
10. **The bullet checks are frozen.** A new heuristic needs a failure seen across new bullets, not one fixture. Every heuristic added so far fixed one case in three fixtures: that's tuning to the tests.

---

## 5. Experiments (Phase 1: recruiter review)

### 5.1 First baseline (`8bbc862`, 3 runs)

- 50/54 checks, 120/121 quotes. Main weakness: employment gap mentioned at medium+ only 1/3 on both gap fixtures. Grounding, injection handling, typo and buzzword detection better than predicted.

### 5.2 Today's date in the prompt

- Without it, the model called a nearly two-year gap "ambiguous" at low severity. Prompts involving time need the current date.

### 5.3 Quote grounding check

- One early Gemini run appeared to have 3/6 quotes not in the resume. That comparison was later found to be against a different resume version, so the hallucination rate claimed there is unreliable. The check itself stands: every quote is verified in code, unverified ones are shown with a warning, and `review_grounding` is logged per review. Whitespace and punctuation are normalized; ellipses and stitched quotes are (correctly) flagged.

### 5.4 Timeline facts computed in code (`8000d88`)

- **Decision:** Parse date ranges in code, compute the gap, show it as a check, and state it in the prompt as a fact. The model judges what the gap means; code does the arithmetic.
- **Evidence:** Gap mentioned at medium+: recent-gap 1/3 → 3/3, my-resume 1/3 → 3/3; recent-gap verdict moved from yes 3/3 to maybe 3/3.
- Parser is our own (tested table of formats), not a general date library. Uncertain dates are read generously (can only shorten a gap).

### 5.5 Quotable date range in the fact (`331b6aa`, kept)

- The model began quoting our fact as if it were resume text (recent-gap grounding 15/17). Including the exact date range from the resume gave it something real to quote. Later confirmed (5.7) that the date range alone, not the stricter heading added alongside it, fixed this.

### 5.6 The typo "regression" that wasn't

- Typo detection appeared to fall from 3/3 to 0/3. Two hypotheses (heading wording, the facts section) were tested and refuted; an identical-to-baseline prompt (`75acbf3`) also scored 1/5.
- Pooled across all variants: **7/19 (~37%)**. The baseline 3/3 was luck.
- **Kept anyway:** shorter facts heading (`45bc9eb`); no timeline fact when there is a current role (`75acbf3`, strong-frontend never mentions a gap 5/5 without it).
- **Deferred:** typo detection to a dedicated proofreader persona (Phase 3), so spelling doesn't compete with bigger issues for space in a short list.

### 5.7 Summary not accepted as evidence (`149813d`)

- Rule: strength evidence must come from work experience; a summary is the candidate's own claim.
- my-resume 2/6 → 5/5. buzzword-summary still criticizes its summary 5/5. Side effect: the rule's wording sometimes appears in feedback as "the summary is a self-claim."

### 5.8 One-clause timeline fact (`31f68b7`)

- Two-clause fact produced duplicate gap issues. One clause: duplicates 2/5 → 2/10. An initial verdict dip (3/5) was confirmed as noise over 10 runs (8/10).

### 5.9 Eval false negative: gap keyword list (rescore)

- Two "failures" were the model correctly flagging the gap as "ended a significant time ago," which matched none of our keywords. Added `ended`, `time since`, `not current`. Rescoring past results flipped exactly the two intended runs and nothing else. Rescore also caught that the private fixture's keyword edit had not been saved.

### 5.10 Baseline (`ef3840f`, rescored after 5.9)

```
Overall: 59/60 checks passed (98%), 122/122 quotes found (100%), 18/18 valid runs
Only failure: weak-duties typo 2/3 (known ~37% rate, deferred to Phase 3)
Median time per review: ~78–86 s
```

---

## 6. Phase 2: job matching and the bullet writer

### 6.1 Spike: can the local model drive a tool loop? (`scripts/spikes/tools.ts`)

- Requirements worded like the resume: 5/5 runs finished, 20/20 verdicts, 15/15 evidence from tools, 0 invalid calls, median 43 s. **Mechanics: yes.**
- Requirements worded like real postings (synonyms): 17/25. The search tool matched *any* word, so "design system" returned an unrelated accessibility line; the model treated it as a weak match and rarely searched again (1 retry after 5 empty searches).

### 6.2 Agent vs. direct baseline (same requirements, same scoring, 5 runs each)

| | Direct (whole resume in prompt, one structured call) | Agent (resume hidden, tools only) |
|---|---|---|
| Verdicts correct | **25/25** | 13/25 |
| Evidence grounded | 20/20 | 15/15 |
| Median time | **54 s** | 80 s |
| Design system (synonym) | 5/5 | 0/5 |
| GraphQL listed only in skills (partial) | 5/5 | 1/5 |
| Performance (evidence uses other words) | 5/5 | 2/5 |

- **Finding:** the model's judgment is good when it can see the whole resume. The agent's failures came from what the tools showed it. Hiding a one- to two-page resume behind search created the problem the agent then failed to solve.
- **Decision:** job matching is a **workflow**: extract requirements, then match them in one structured call with the full resume and code-computed facts. The agent loop goes where iterating adds value a single call can't: bullet writing (6.8 onward).
- **Rejected:** semantic (embedding) search to rescue the matching agent. It fixes a problem only the agent design has.

### 6.3 Job-matching evals and baseline (`615ae81`)

- Extraction and matching are evaluated **separately**: matching runs against each fixture's saved requirement list, so an extraction mistake can't show up as a matching failure. Expected answers reflect **what the resume shows, not what the candidate knows** (missing accessibility work is a resume gap, not a model error).
- Extraction: **132/132** found, tiers 132/132, 0 extras, 0 boilerplate, 0 reworded. Matching: 128/132 (97%).
- The degree requirement ("…or equivalent practical experience") was met in only 2 of 4 runs, and when met, the evidence was the degree line rather than experience.

### 6.4 Equivalent experience stated as a fact (`a6564b9`); a label correction

- Code detects "or equivalent … experience" and states it next to that requirement with the computed experience total. Degree: met 2/4 → **5/5**.
- **Label correction:** one requirement was an "or" list ("monorepos, package publishing, … or migration tooling") mislabeled as needing everything. Rule adopted: "or" = any one, "and" = all; applied to all 37 requirements, only that one changed; verified by rescoring (exactly 3 intended flips, nothing else).

### 6.5 Evidence for computed requirements (`442d1a8` → `9e079c5`)

- Quotable date ranges in the fact raised good evidence from ~2 in 5 to 13/15, but the passing evidence was weak (a single 10-month role offered as proof of 6+ years) and the fact was still quoted twice.
- **Decision:** for requirements stating years or accepting equivalent experience, **code supplies the evidence** (the total and its date ranges). The model still decides the status.
- **Rejected:** restoring the stricter "never quote facts" heading: it lowers a failure rate; this removes the failure.

### 6.6 Job-matching baseline (`9e079c5`)

- **132/132 accepted** across all three fixtures; **89/89** model-chosen quotes grounded (computed evidence excluded from grounding stats).
- Empty gaps on "missing" answers appeared after the date-range change (3 of 8 runs, always the same three requirements). Code fills "Not shown on the resume." and flags it, so evals still count the omission.

### 6.7 Job matching in the app

- Results stream requirement by requirement: the server reads each complete item from the model's JSON as it arrives, validates it, and sends it as its own event, using the same code as the final report (a test confirms streamed equals final).
- **Rejected:** a general partial-JSON parser (half-written strings flicker and can't be validated) and parsing in the browser.
- Display: calculated evidence is labeled; a repeated quote is shown once, then referred back to; "Not shown" rather than "Missing" (the tool judges the resume, not the person); red only for required qualifications.

### 6.8 Bullet loop, first spike

- Evaluator–optimizer loop: draft → code checks (numbers, named terms, length, first person) → model judge for unsupported claims → revise with specific failures. The target requirement is never a source of facts.
- 15/15 by the automated bar, but user ratings were 4 use-as-is, 4 with edits, **2 rejected**, and both rejects came from revisions triggered by false flags (an "HTML" term flag; a judge flag on restated source text).
- Lesson: the checks measured safety, never quality; "passes every check" rewarded vague bullets.

### 6.9 Fixing false flags, validated against ratings

- Fixes: implied terms (VoiceOver → screen readers, `<h2>` → HTML); dismissing judge flags whose words all appear in the sources; generic build verbs interchangeable (leadership verbs excluded on purpose).
- Ratings after: 6 as is, 4 with edits, **0 rejected**.
- **Rejected after checking against ratings:** a coverage requirement (it would have rejected the bullets rated best) and keep-the-terms (the user accepted a bullet without the tech stack).
- Judge record at that point: 1 real catch, ~11 false alarms, all on single-bullet rewrites.

### 6.10 Candidates from different angles

- One draft call produces up to three candidates from different angles; each is checked and revised independently. Accessibility: three distinct angles in 3/3 runs (overlap 0.04), including the zoom fix and the screen readers by name.
- **Safety by code, quality by choice.** The user's personal style (avoided words, preferred replacements) is enforced in code, not just requested in the prompt. Universal rule added to the prompt: no generic purpose endings ("to improve accessibility") without a stated result.

### 6.11 Code syntax kept out of bullets; checks frozen

- Code-level details (`role=group`, `aria-labelledby`, `<h2>`) are a personal style setting: category terms on the resume, specifics in the interview.
- **Rejected:** checking every lowercase term in code. It either breaks rewording or needs a technology dictionary that's never complete.
- The bullet checks are frozen (4.4, rule 10).

### 6.12 Bullet writer in the app

- Opens inline from any requirement marked Partly or Not shown. Candidates stream as each passes; failing ones are counted, never offered. The user's edits are checked in the browser by the same code, as warnings, not blocks. Writing style persists in the browser; notes are never stored. One request at a time across review, match, and bullets.
- First real use: 3 of 3 candidates passed, all usable.

### 6.13 False links between facts (`1988884`)

- The project's own bullets linked separate systems ("a bullet loop… to improve employment-gap detection"). The checks guarantee every fact comes from the notes, not that links between facts are true.
- Judge given a "relationship" category; relationship flags are never dismissed. Side effect: judge false alarms dropped to 0 in the next spike (footer: 24 flags → 0).
- Judge tested on labeled bullets: caught **1 of 3** kinds of false link (only a false cause attached to a measured result), missed both purpose-clause links ("to improve", "to ensure"); **0 false alarms** on 4 correct bullets.
- **Change (`1988884`):** user-grouped notes (a blank line between unrelated work); bullets stay within one group; the judge treats links across groups as unsupported. A false link *within* one group is out of its reach; the interface tells the user to check links.
- **Success bar (set before running):** links across groups caught 4/4; correct bullets wrongly flagged 0/6; the within-group link recorded either way (predicted missed); no final candidate combines groups; "passing with a source number" keeps its baseline (5/12).
- **Judge, 11 labeled bullets:** links across groups **caught 4/4**, all as "relationship", and the reasons name the groups. The within-group link ("comparing a tool-calling agent… to ensure accurate extraction") was **missed**, as predicted. Correct bullets wrongly flagged: **1/6** (bar 0/6). That bullet states two facts from one group: matching shipped as a workflow, and matching scored 132/132. The judge said the notes don't state the shipped workflow achieved 132/132, so it rejected a correct two-step inference. The run was repeated at `93185f7` (which only added logging) with the same 11 verdicts, as expected at temperature 0.
- **Bullets, 4 cases × 3 runs:** 12/12 runs succeeded, 36/36 candidates passing. On project-ai no final candidate combines groups. Passing with a source number: 5/9 (baseline 5/12). One project-ai final has a within-group false link: round 1 was flagged as a relationship ("comparison… successfully grounding every quote"), and the revision restated the link with a number ("Compared… reaching 89/89 grounded quotes"), which the judge passed. The judge checks each round from scratch, without earlier flags.
- **Conclusion:** grouping works for links across groups (4/4, 0 combined finals). Within one group the judge is unreliable in both directions (1 catch, 2 misses, 1 false alarm), so the safeguard there is the interface line telling the user to check links.
- **Not fixing now:** each behavior is one example (4.4, rule 10). **Rejected for now:** a judge prompt change for the false alarm, which would change a shared prompt on one example.
- **Prediction for the next spike:** if a revision restates a flagged link again, carry relationship flags forward to the next judge call.

---

## 7. Phase 3: multiple reviewers

### 7.1 Is the proofreader a model? (`scripts/spikes/proofread.ts`)

- **Question:** the recruiter caught typos ~37% of the time (5.6). Does a code spell checker (cspell with its software-terms and companies dictionaries, no project wordlist) do the proofreader's job, or is a model needed?
- **Setup:** two synthetic fixtures with user-confirmed labels: `typos` (6 non-word, 5 real-word, 3 tech-casing errors, 10 correct-but-uncommon "trap" terms) and `typos2` (3, 8, 3, 10). Model: new dedicated prompt and schema, temperature 0 set explicitly (`callStructured` has no default, so Ollama would use the model's own 1.0), quotes grounded as in reviews. One run each, since temperature-0 runs repeat.
- **Success bar (set before the second fixture):** model catches at least 4/8 real-word errors with at most 1 false alarm; otherwise a model proofreader isn't worth ~85 s.
- **Results** (non-word / real-word / casing / traps flagged / other false alarms):

| | `typos` | `typos2` |
|---|---|---|
| code | 6/6, 0/5, 1/3, 3/10, 5 | 2/3, 0/8, 0/3, 3/10, 0 |
| model, plain prompt | 6/6, 2/5, 2/3, 0/10, 0 | 3/3, 7/8, 3/3, 0/10, 0 |
| model told what code flagged, looking only for real-word and casing errors ("hybrid prompt") | 6/6, 2/5, 3/3, 3/10, 5 | 2/3, 5/8, 3/3, 3/10, 0 |

  Latency: code ~1 s, model ~85-105 s. `typos2` was rerun on a clean commit (`be469b3`) with identical counts.
- **Findings:**
  - Code cannot see real-word errors (0/13) and caught 1/6 casing errors. Its trap flags are names and tools missing from the dictionaries (company names, Vite), so it would need a wordlist.
  - The plain model had 0 false alarms in both fixtures (all 20 traps untouched, every quote grounded) and caught 9/9 non-words, 9/13 real-word and 5/6 casing errors.
  - The hybrid prompt was no better than the plain model on either fixture and worse on `typos2` (told to leave non-words to code, it lost `plyer`, a word code's dictionary accepts, and two real-word errors).
- **Decision:** the proofreader is a model with the plain prompt. Code spell checking is not added: it finds almost nothing the model misses and brings false alarms.
- **Caveats:** real-word recall was 2/5 on one fixture and 7/8 on the other, so ~70% pooled is a rough figure. One run per fixture, synthetic text, one model. No real-resume check will be run: evaluation stays on synthetic fixtures (7.2).
- **Not decided:** whether `cspell-lib` stays as a dependency (it is a devDependency for the spike only).

### 7.2 Three reviewers in one stream, per-reviewer expectations

- **Structure:** one `/api/review` request runs the recruiter, the hiring manager and the proofreader one after another (the local model handles one request at a time) and streams each result as it finishes, as job matching does. The browser shows one tab per reviewer with a status mark, so a finished review is readable while the rest run. One reviewer failing is reported on its own tab and the others still run. Total time is about 4-5 minutes locally.
- **The proofreader is not a persona.** Personas are data fed to the shared review pipeline and return a verdict, strengths and ranked issues. A proofreader returns a flat list of corrections, so forcing it into that shape would add a fake verdict. It has its own pipeline, event (`proofread_done`) and panel behind the same `Reviewer` list.
- **The hiring manager is a persona** (technical depth, relevance to the role the resume itself targets, skills backed by work, scope, growth). Posting fit stays in the Match tab, so it has no posting input.
- **Per-reviewer expectations:** a fixture's `expect` is the recruiter's, and an optional `reviewers: { "<persona id>": {...} }` map holds the others. A reviewer is scored only on fixtures that list it. Rejected: one combined expectation per fixture, because a miss could not be attributed to a reviewer (4.4, rule 2). The proofreader is scored on `*.labels.json` files (7.1).
- **Hiring-manager baseline** (`6094ce0`, 4 fixtures x 3 runs, bar set beforehand): **39/39 checks**, 74/74 quotes found, 12/12 valid runs. "No technical depth" on `weak-duties` was found in the first issue at high severity in 3/3 runs. Caveat: this is a ceiling result on keyword checks that are partly copied from the recruiter's, so it shows the expected topics come up, not how the hiring manager differs from the recruiter. The hiring manager gives `buzzword-summary` "yes" 3/3, which the user confirmed is the right verdict (solid experience undercut by its summary), so no verdict rule is needed there.
- **Recruiter prompt: "typos" removed from its focus** (one word, shared prompt, `6935805`). Recruiter eval on the five public fixtures, 3 runs each: baseline (`6094ce0`) 49/51 checks, 90/90 quotes; after the change 49/51 checks, 92/94 quotes. Every check other than the `weak-duties` typo was 3/3 in both, and the typo check was 1/3 in both: **the change is behavior-neutral**, and the recruiter still mentions the typo at the same rate without being asked. One `recent-gap` run had 2 ungrounded quotes (baseline 0); one run in fifteen, treated as noise, to recheck if it recurs.
- **Expectation move (rule 10):** the rule is "typos belong to the proofreader once the recruiter prompt drops them". Applied to the one recruiter typo expectation (`weak-duties`) and verified with `--rescore` on both runs: each went from 49/51 to 48/48, the three removed checks being exactly the typo check (1 pass, 2 fails), with no other result changing.
- **Synthetic fixtures only:** the user decided not to use their own resume for evals or the proofreader check, so all numbers here come from public fixtures. The private fixture's PDF is missing and it was left out of the baseline and after-run, which used the five public fixtures.
- **A fixture where the hiring manager should differ** (`skills-not-shown`, `8e4f020`, 3 runs each, bar set beforehand): a senior title over "worked on / helped / assisted" bullets, with clear dates and numbers, and skills (Kubernetes, Terraform, Rust) that no bullet uses. Hiring manager: verdict "maybe" 3/3, named a listed-only skill 3/3, raised the title-versus-scope gap 3/3, **12/12 checks**, 22/22 quotes. Recruiter: verdict "yes" 3/3, **6/6 checks**, 23/23 quotes (prediction held). The verdict split is the clear difference. Counting keyword hits in the saved issues (counts only), the recruiter also named the skills and the scope gap in 2/3 runs, so it notices much of the same but still advances the resume. Caveats: one fixture, 3 runs, blunt keyword checks, and the fixture was built so the hiring manager would object, so it shows it can differ when it should; `strong-frontend` (yes or maybe from both) covers staying quiet when it shouldn't. The recruiter eval now covers 6 fixtures.

### 7.3 Four fixtures where the reviewers should differ: they mostly don't

- **Fixtures** (`3477e30`, 3 runs each, both reviewers, bar set beforehand): `short-tenures` (four roles of 7-10 months, each with shipped work), `career-changer` (a teaching career plus two detailed projects, no engineering title), `inflated-scope` (a senior title over a team of two and tiny numbers), `wrong-specialty` (a strong data-engineering record under a frontend summary). The user confirmed the labels. Predicted: the recruiter stricter on the first two, the hiring manager stricter on the last two.
- **Bar:** verdicts inside the expected set on all runs, and the two reviewers' verdicts differing on at least 3 of 4 fixtures.
- **Result: both missed.** Recruiter 26/30 checks, hiring manager 27/30, 100% of quotes found, every failure a verdict check. Verdicts (recruiter / hiring manager): `short-tenures` yes 2, maybe 1 / yes 3; `career-changer` yes 2, maybe 1 / yes 3; `inflated-scope` maybe 3 / maybe 3; `wrong-specialty` maybe 3 / yes 3. Only `wrong-specialty` differs, and the hiring manager is the more lenient one, the reverse of the label.
- **Cause (read from the saved reviews, rule 5):** the reviewers see the problems, and every keyword check passed 3/3, but the verdict does not follow the issue list. The hiring manager called the frontend-versus-data mismatch a **high** issue in 3/3 runs and still said "yes" (one summary: "a significant and confusing mismatch"). The recruiter raised "lacks professional software engineering experience" as high and said "yes". It raised short stays only as medium and said "yes" 2/3, praising the bullets.
- **One pass was for the wrong reason:** the only recruiter "maybe" on `short-tenures` cites "significant and confusing overlaps in the employment dates", which is false (the ranges don't overlap), and never mentions the short stays. Quote grounding can't catch it, since the quotes are real.
- **Decision:** the expectations stay (no rule changes them, rule 10; "the model disagreed" is not a rule). The finding is that `wouldAdvance` is a weak signal: reviews name issues without letting them move the verdict. Not yet fixed. Tried as its own experiment, then built.
- **Rule:** if the model says "yes" and any issue is high severity, the verdict becomes "maybe" (`src/lib/review/verdict.ts`, applied in `runReview` so the app and the evals both see it). It only lowers, and leaves "maybe" and "no" alone. The model's answer stays on the review (`verdictCap.modelVerdict`) and the panel shows a one-line note, so the user isn't misled about what the reviewer said.
- **Bar (set before scoring):** no verdict check that passes today may fail; the checks failing on "yes plus high issue" must pass; a clearly good resume must not be downgraded in more than a third of runs.
- **Why no live run:** the cap runs after the model answers and changes nothing the model writes, so scoring it on saved runs is exact. 54 clean Ollama runs on public fixtures at the current prompt: verdict checks 47/54 before, **51/54** after, 0 regressions. Fixed: hiring manager on `wrong-specialty` 0/3 to 3/3, recruiter on `career-changer` 1/3 to 2/3. Cost: 0 of 6 `strong-frontend` runs capped; 1 `buzzword-summary` recruiter run capped (no verdict expectation there).
- **Not fixed:** `short-tenures` (the recruiter raises the short stays as medium, so the cap doesn't apply) and a `career-changer` "yes" with no high issue: 3 of 54. A medium threshold would cap nearly every review, so it wasn't tried.
- **Full eval after the cap** (`6843e6b`, clean tree, 3 runs per fixture): recruiter 10 fixtures **78/84** checks, 196/199 quotes; hiring manager 9 fixtures **82/84**, 179/181 quotes; proofreader on 4 labeled resumes unchanged (non-words 10/10, real-word 16/21, casing 5/6, 0 trap flags). No verdict check that passed before failed. The six recruiter misses are exactly `career-changer` and `short-tenures` (0/3 each, "yes" with no high issue, so the cap can't apply; both were 2/3 and 1/3 when scored on saved runs, so verdicts vary run to run). The cap fired only where intended: hiring manager on `wrong-specialty` 3 of 3 runs (that check 0/3 to 3/3 live), the recruiter never, and no `strong-frontend` run was capped.
- **An unstable check, not a regression:** hiring manager "mentions listed skills not shown" on `skills-not-shown` was 3/3 when added (7.2) and 1/3 and 1/5 at `6843e6b`. Rule 4 check, 5 runs at the earlier commit (`8e4f020`, a throwaway worktree): 3/5. Pooled, 6/8 then and 2/8 now: not distinguishable at this size, and no model-facing code changed in between (the cap runs after the model answers). Reading the misses, the model raises ownership and depth and leaves the unused skills out of the issue list. Treat the check as passing roughly half the time; the "12/12" recorded in 7.2 was a favourable draw. Not fixed, and the expectation is unchanged (no rule from its wording changes it, rule 10).
- **Quotes:** 5 of 380 ungrounded across the two full runs (earlier runs were near 100%). Watching; read those reviews if the count grows.
- **Caveat:** the rule was chosen after seeing these failures, so the 47 to 51 shows it does what it says, not how it generalizes. The one independent signal is that it left the good-resume fixtures alone.

### 7.4 Short tenures: a code fact for the recruiter

- **Problem (7.3):** the recruiter named short stays as a medium issue on `short-tenures` and still said "yes" (0/3 and 1/3 on the verdict check). Prompt wording would have added a rule with no evidence behind it; the verdict cap (7.3) doesn't apply to a medium issue.
- **Change (one):** `tenureFacts` in `src/lib/checks/timeline.ts`. When three or more date ranges are shorter than 12 months, the review prompt gets a computed fact listing them, each quoted with its length ("Mar 2025 – Nov 2025" (8 months)). It says code can't tell jobs from internships, contracts or courses, so the model judges. Silent below three, so one or two brief roles don't trigger it. The threshold of 3 is a judgement, not measured. The fact goes to both personas through the shared prompt, so the run covered both.
- **Counter-fixture:** `student-internships` (three internships of 2-4 months, the fact triggers). Neither reviewer may call it job-hopping, and both should say yes or maybe.
- **Bar (set before the run):** recruiter verdict on `short-tenures` no or maybe in at least 2 of 3 runs; `student-internships` 3/3 for both reviewers; no other check that passed before may fail (ignoring the unstable "listed skills not shown"); hiring manager stays yes or maybe on `short-tenures`; ungrounded quotes near the earlier rate.
- **Result** (`07cee5d`, clean, 3 runs each): recruiter **91/93** checks, hiring manager **92/93** (93/93 after the label fix below). `short-tenures` recruiter verdict **maybe 3/3** (from 0/3 and 1/3) and it still names the short stays 3/3. `student-internships`: recruiter 3/3 clean; hiring manager "yes" 3/3. Hiring manager on `short-tenures`: yes 1, maybe 2 (inside its set). The recruiter's two remaining misses are the known `career-changer` verdict (1/3). No collateral on any other check.
- **Label fix (rule 10):** the one hiring-manager miss on `student-internships` was a low issue calling the experience "internship-based and short-term" with the suggestion "add weight to the short tenure"; the verdict stayed "yes". The fixture's rule is job-hopping language, so the keywords `short tenure*` and `short stint*` (which just describe an internship) were removed, leaving `hop*`, `unstab*`, `stability`, `turnover`. Verified with `--rescore` on both result files: exactly that one check flipped (fail to pass), nothing else changed.
- **Cost, stated plainly:** ungrounded quotes were **18 of 412 (4.4%)**, against 5 of 380 (1.3%) in the run before. Five come from the fact itself: four quotes that stitched its date ranges into one, one that quoted the fact's own sentence as resume text (the open "fact quoted as resume text" item). The other 13 are the usual kind (skills lines quoted with a "SKILLS:" prefix, stitched headers), also higher than before, so some of the rise is not from this change. The panel already marks an unfound quote, so a user sees the warning. Kept: the target is met with no verdict collateral. Not fixed; if the fact-caused share grows, the fix is to stop quoting ranges in the fact, as a separate change.

### 7.5 A prompt line for the career changer: no effect, reverted

- **Problem:** the recruiter says "yes" on `career-changer` (a teaching career, two detailed projects, no engineering title) in most runs, even though it names the missing professional experience 3/3. Code can't tell a teaching job from an engineering one, so no fact applies.
- **Change (one, recruiter only):** a sixth focus item: "Does the work history show professional experience in the role this person is targeting? Internships count. Work in another field and personal projects are worth noting, but they are not the same as time in the role, however well built." (`b6a2a4c`.)
- **Bar (set before the run):** `career-changer` verdict maybe or no in at least 2 of 3 runs; `student-internships` stays yes or maybe 3/3 without job-hopping language; no recruiter check that passed before may fail; ungrounded quotes no worse. Revert if the target is not clearly met.
- **First run** (`b6a2a4c`, 3 runs): target met at 2/3, counter-fixture clean, but two checks that were 3/3 dropped to 2/3 (`short-tenures` verdict, `career-changer` "mentions no engineering experience"), 90/93 overall.
- **Rule-4 comparison, 5 runs each on both fixtures, before (`07cee5d`) and after (`b6a2a4c`): identical.** `career-changer` verdict maybe or no 1/5 in both; "mentions no engineering experience" 4/5 in both; `short-tenures` verdict no or maybe 3/5 in both; 23/30 checks both. The 2/3 and the two drops were run-to-run noise; the wording changed nothing measurable.
- **Decision:** reverted. A prompt line with no measured effect only adds length. `career-changer` stays open: the recruiter's "yes" is defensible for an entry-level target, and neither code (no computable fact) nor a prompt line moved it. What remains is a label question for the user: whether "yes" is the right recruiter answer there.
- **Correction to 7.4:** the recruiter's `short-tenures` verdict with the tenure fact is no or maybe in about 3 of 5 runs at both commits (3/3 and 2/3 in the full runs). Pooled that is roughly 8 of 11, against 0/3 and 1/3 without the fact. The fact helps but is not reliable, and the 3/3 recorded in 7.4 was a favourable draw.

### 7.6 The hosted demo: replay recorded model answers

- **Question (Phase 5):** how does a public site work when the model is a local 8B one, a review takes 4-5 minutes, and resumes are private? Options weighed: a recorded demo, bring-your-own-key, a paid hosted model with limits, a self-host guide, an in-browser model.
- **Decision (user): a recorded demo plus a self-host guide.** It costs nothing, no resume ever reaches a model, and it shows the project's point: measured behavior on real model output. Bring-your-own-key and a paid tier are deferred until real users appear (job seekers rarely hold API keys; a paid tier breaks no-spend and adds retention and abuse work; a different model would also need the evals rerun first).
- **Design: replay at the model boundary.** A `replay` provider next to `ollama`, `gemini` and `mock` (`src/lib/llm/replay.ts`) answers a request with what a real model said earlier. Everything after the call (quote grounding, the verdict cap, streaming, the UI) still runs for real. Rejected: recording the finished event stream and replaying events (grounding, the cap and the facts would freeze at recording time, the demo could drift from the code, and it could not be tested), and storing only final results.
- **A recording is found by a hash of the system prompt, the user prompt and the output schema.** Change a persona, a computed fact or the schema and the key changes, so an old recording can never be shown for a new prompt. A missing recording fails with a plain message, never a wrong answer.
- **The prompts contain today's date** (the system prompt, and the gap and tenure facts), so a recording would expire overnight. Found while writing the record script. Fix: samples always run as of a fixed `DEMO_TODAY` (2026-10-20), passed through `runReviewers`, and the checks use it too so they agree with the reviews. Re-recording moves the date.
- **Recording (`npm run demo:record`):** the real pipeline through the same `runReviewers` the app uses, one run per sample, kept as it came, so no best-of-several. A full run clears the folder first so stale recordings don't pile up. Samples are public synthetic fixtures only; `loadSample` refuses anything but a plain file name in `fixtures/`.
- **The four samples** (`strong-frontend`, `weak-duties`, `skills-not-shown`, `wrong-specialty`) were recorded at ~4-5 min each. The single runs came out: recruiter yes / maybe / maybe / maybe, hiring manager yes / no / maybe / maybe, proofreader 0 / 1 / 0 / 0 findings, all quotes grounded. **Two blurbs had promised outcomes the recording did not show** (the recruiter and hiring manager splitting on `skills-not-shown`, the verdict cap note on `wrong-specialty`), so blurbs now describe the resume only. The page says it is one real run.
- **Guarded by tests:** every sample must have a recording for every reviewer under the current prompts, and the folder must hold exactly that many files. Verified by adding two words to the recruiter prompt: the four sample tests failed at once.
- **Demo behavior:** `/api/review` accepts `sample` only when the provider is `replay` (unknown ids 404, other providers 400). An uploaded PDF still gets the live parser view and checks, and the reviewer tabs show "only recorded for the samples" through the existing error path. Upload was kept (user decision) with a footer saying a PDF is read on the server, not stored, and no model sees it. The Match tab says matching and the bullet writer are not in the demo yet. A replayed call shows "(recorded run)" and no time, since it answers in milliseconds.
- **Cost, stated plainly:** a change to a persona, a fact, the schema or a sample resume breaks the recordings test until `npm run demo:record` is run and the recordings are committed (about 20 minutes of model time). A recording is one run, so its verdicts can differ from the eval numbers.
- **Not done:** deployment (needs a host), Match and bullets in the demo. The review route's `maxDuration = 60` is unchanged: replay is fast, and a real model behind a host would still need the per-reviewer split or a longer limit.

---

## 8. Open items

- **Proofreader on realistic text:** measured only on synthetic fixtures (real-word recall 2/5 and 7/8), by decision (7.2). More synthetic fixtures with harder real-word errors would be the way to tighten the estimate.
- **Recruiter on `career-changer`:** "yes" in about 4 of 5 runs against a label of maybe or no. Not moved by a computed fact (none exists) or by a prompt line (7.5). Needs a decision on the label.
- **Hiring manager vs recruiter:** separated on verdict by `skills-not-shown` (7.2) but not by four more fixtures (7.3): the verdict doesn't follow the reviews' own issue list. Open: whether to cap the verdict by issue severity in code.
- **Links within one group** are not reliably judged (1 catch, 2 misses, 1 false alarm on a correct two-step inference). Covered by the interface line; one example each, so no fix yet (6.13).
- **A revision can restate a flagged link** with a number, and the judge then passes it, because each round is judged without earlier flags (seen once, 6.13). If it repeats, carry relationship flags forward.
- **Verdicts vary between runs** of the same input: lower temperature, majority vote, or showing borderline verdicts.
- **Job evals lack a summary-as-evidence check** (review evals have one).
- **Number use in project bullets is intermittent** (5 of 12 candidates). Watching, not fixing.
- **The model sometimes asks for facts the notes already contain** (seen once).
- **Fact quoted as resume text** in reviews (~1 run in 10), and **stitched role-header quotes**: correctly flagged, not fixed.
- **Latency**: ~80 s per review, 2–5 min per bullet run, one request at a time on 16 GB.
- `useReviewStream` hasn't moved onto `useNdjsonRequest`.
- **Hosting** (Phase 5): the demo is built (7.6) but not deployed (needs a host). Bring-your-own-key or a paid model, if real users appear, needs the evals rerun on that model first. The Match tab and the bullet writer are not in the demo.
