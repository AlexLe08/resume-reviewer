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

## 6. Phase 2: job-description matching

### 6.1 Spike: can the local model drive a tool loop? (`scripts/spikes/tools.ts`)

- Requirements worded like the resume: 5/5 runs finished, 20/20 verdicts, 15/15 evidence from tools, 0 invalid calls, median 43 s. **Mechanics: yes.**
- Requirements worded like real postings (synonyms): 17/25. The search tool matched *any* word, so "design system" returned an unrelated accessibility line; the model treated it as a weak match and rarely searched again with different words (1 retry after 5 empty searches).

### 6.2 Agent vs. direct baseline (same requirements, same scoring, 5 runs each)

| | Direct (whole resume in prompt, one structured call) | Agent (resume hidden, tools only) |
|---|---|---|
| Verdicts correct | **25/25** | 13/25 |
| Evidence grounded | 20/20 | 15/15 |
| Median time | **54 s** | 80 s |
| Design system (synonym) | 5/5 | 0/5 |
| GraphQL listed only in skills (partial) | 5/5 | 1/5 |
| Performance (evidence uses other words) | 5/5 | 2/5 |

- **Finding:** The model's judgment is good when it can see the whole resume. The agent's failures came from what the tools showed it, not from reasoning. Hiding a one- to two-page resume behind search created the problem the agent then failed to solve.
- **Decision:** Job matching is a **workflow**: extract requirements from the posting, then match them in one structured call with the full resume and code-computed facts (e.g. years of experience). The spike is kept as a record, not built on.
- **Where the agent loop goes instead:** somewhere looking things up and iterating genuinely adds value that one call can't provide. Leading candidate: an evaluator–optimizer loop for rewriting bullets (draft a rewrite → check it against the resume with tools and code → revise until it holds up).
- **Rejected for now:** semantic (embedding) search to rescue the matching agent. It would fix a problem only the agent design has.

---

## 7. Open items

- **Proofreader persona** (Phase 3): close the typo gap (~37%).
- **Fact quoted as resume text:** ~1 run in 10. The stricter "never quote facts" heading was reverted for a reason later disproved; restoring it is an option if this grows.
- **Stitched role-header quotes** (title joined to dates, skipping the location): 2 in ~15 runs. Correctly flagged; no fix yet.
- **Phase 3 latency:** ~80 s per review locally and one request at a time on 16 GB. Five personas means minutes per resume; stream each reviewer's result as it finishes.
- **Hosted-model decision** (Phase 5): paid tier with limits, bring-your-own-key, or in-browser.
