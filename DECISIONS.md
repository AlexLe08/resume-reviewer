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
- **Caveats:** real-word recall was 2/5 on one fixture and 7/8 on the other, so ~70% pooled is a rough figure. One run per fixture, synthetic text, one model. The real-resume check (labels in `fixtures/private/`) has not been run.
- **Not decided:** whether `cspell-lib` stays as a dependency (it is a devDependency for the spike only).

### 7.2 Three reviewers in one stream, per-reviewer expectations

- **Structure:** one `/api/review` request runs the recruiter, the hiring manager and the proofreader one after another (the local model handles one request at a time) and streams each result as it finishes, as job matching does. The browser shows one tab per reviewer with a status mark, so a finished review is readable while the rest run. One reviewer failing is reported on its own tab and the others still run. Total time is about 4-5 minutes locally.
- **The proofreader is not a persona.** Personas are data fed to the shared review pipeline and return a verdict, strengths and ranked issues. A proofreader returns a flat list of corrections, so forcing it into that shape would add a fake verdict. It has its own pipeline, event (`proofread_done`) and panel behind the same `Reviewer` list.
- **The hiring manager is a persona** (technical depth, relevance to the role the resume itself targets, skills backed by work, scope, growth). Posting fit stays in the Match tab, so it has no posting input.
- **Per-reviewer expectations:** a fixture's `expect` is the recruiter's, and an optional `reviewers: { "<persona id>": {...} }` map holds the others. A reviewer is scored only on fixtures that list it. Rejected: one combined expectation per fixture, because a miss could not be attributed to a reviewer (4.4, rule 2). The proofreader is scored on `*.labels.json` files (7.1).
- **Hiring-manager baseline** (`6094ce0`, 4 fixtures x 3 runs, bar set beforehand): **39/39 checks**, 74/74 quotes found, 12/12 valid runs. "No technical depth" on `weak-duties` was found in the first issue at high severity in 3/3 runs. Caveat: this is a ceiling result on keyword checks that are partly copied from the recruiter's, so it shows the expected topics come up, not how the hiring manager differs from the recruiter. The hiring manager gives `buzzword-summary` "yes" 3/3, which the user confirmed is the right verdict (solid experience undercut by its summary), so no verdict rule is needed there.
- **Recruiter prompt: "typos" removed from its focus** (one word, shared prompt, `6935805`). Recruiter eval on the five public fixtures, 3 runs each: baseline (`6094ce0`) 49/51 checks, 90/90 quotes; after the change 49/51 checks, 92/94 quotes. Every check other than the `weak-duties` typo was 3/3 in both, and the typo check was 1/3 in both: **the change is behavior-neutral**, and the recruiter still mentions the typo at the same rate without being asked. One `recent-gap` run had 2 ungrounded quotes (baseline 0); one run in fifteen, treated as noise, to recheck if it recurs.
- **Expectation move (rule 10):** the rule is "typos belong to the proofreader once the recruiter prompt drops them". Applied to the one recruiter typo expectation (`weak-duties`) and verified with `--rescore` on both runs: each went from 49/51 to 48/48, the three removed checks being exactly the typo check (1 pass, 2 fails), with no other result changing.
- **Not covered:** the private resume was not part of the baseline or the after-run (its fixture's PDF is missing), so it has no before/after.

---

## 8. Open items

- **Proofreader on a real resume** (Phase 3): the model proofreader is built and in the app (7.1, 7.2) but only measured on synthetic fixtures (real-word recall 2/5 and 7/8). The check on a real resume is still to do.
- **Hiring manager vs recruiter:** the 39/39 baseline doesn't show how they differ (7.2). Needs a fixture where only the hiring manager should object (skills listed but never used in the work).
- **Links within one group** are not reliably judged (1 catch, 2 misses, 1 false alarm on a correct two-step inference). Covered by the interface line; one example each, so no fix yet (6.13).
- **A revision can restate a flagged link** with a number, and the judge then passes it, because each round is judged without earlier flags (seen once, 6.13). If it repeats, carry relationship flags forward.
- **Verdicts vary between runs** of the same input: lower temperature, majority vote, or showing borderline verdicts.
- **Job evals lack a summary-as-evidence check** (review evals have one).
- **Number use in project bullets is intermittent** (5 of 12 candidates). Watching, not fixing.
- **The model sometimes asks for facts the notes already contain** (seen once).
- **Fact quoted as resume text** in reviews (~1 run in 10), and **stitched role-header quotes**: correctly flagged, not fixed.
- **Latency**: ~80 s per review, 2–5 min per bullet run, one request at a time on 16 GB.
- `useReviewStream` hasn't moved onto `useNdjsonRequest`.
- **Hosted-model decision** (Phase 5): mock demo mode, bring-your-own-key, or paid with limits.
