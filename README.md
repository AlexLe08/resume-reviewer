# Resume Reviewer

Shows job seekers two things about their resume:

1. **What a parser sees.** The plain text software extracts from the PDF, plus deterministic checks (selectable text, contact info, standard sections, length).
2. **How reviewers read it.** Three reviewers: a recruiter, a hiring manager and a proofreader. Every point is backed by a quote from the resume, checked in code.

It also matches a resume to a job posting and helps write honest bullets from your own notes. Behavior is measured with evals (`DECISIONS.md` is the log of what was tried and why).

**Try the demo:** https://resume-reviewer-sepia.vercel.app replays recorded reviews for four sample resumes, with no model behind it. See [Demo build](#demo-build-and-running-it-yourself).

## Getting started

Requires Node 20.9+ (22 recommended, see `.nvmrc`).

```bash
npm install
cp .env.example .env.local   # defaults to a local Ollama model
npm run dev                  # http://localhost:3000
```

Settings in `.env.local` are read once at startup. **Restart `npm run dev` after changing them.**

## Model providers

Set `LLM_PROVIDER` in `.env.local`:

| Provider | Use it for | Needs |
| --- | --- | --- |
| `ollama` (default) | Day-to-day development and evals. Free, private, no rate limits | Ollama running locally, model pulled |
| `gemini` | Comparing against a hosted model | `GEMINI_API_KEY` ([AI Studio](https://aistudio.google.com)) |
| `mock` | UI work. Instant, canned review, no model | Nothing |
| `replay` | The demo build: plays back recorded real answers for the sample resumes | The files in `demo/recordings` |

### Ollama setup (macOS)

```bash
brew install ollama
ollama serve                 # leave running in its own terminal
ollama pull gemma4:e4b-it-q4_K_M   # ~8B model at 4-bit (GGUF), fits 16 GB Apple Silicon
```

Notes:

- Use GGUF model tags (e.g. ending in `-q4_K_M`). Homebrew's Ollama can't do structured output with the MLX tags Macs pull by default, and fails with HTTP 501.
- Run Ollama natively, not in Docker. Containers on macOS can't use the Apple Silicon GPU.
- On a 16 GB Mac, stop Colima / Docker Desktop / OrbStack while reviewing; an 8B model plus a container VM plus your browser is tight.
- The first request after starting Ollama loads the model into memory and is slow. Later ones are faster until Ollama unloads it after a few idle minutes.
- To try another model: `ollama pull <name>`, set `OLLAMA_MODEL`, restart the dev server. Compare models with the "Quotes found in resume" number, not by feel.

## Demo build and running it yourself

**Run it yourself (the full app, your own resume, nothing leaves your computer):**

1. Install [Ollama](https://ollama.com), then `ollama pull gemma4:e4b-it-q4_K_M` (see the setup notes above, including the GGUF tag).
2. `npm install`, copy the example settings to `.env.local`, then `npm run dev`.
3. Open http://localhost:3000, choose a PDF and review it. A full review takes about 4-5 minutes on a 16 GB Mac: the three reviewers run one after another on a small local model.
4. Without a model, `LLM_PROVIDER=mock npm run dev` gives instant canned reviews for working on the UI.

**Demo build (live at https://resume-reviewer-sepia.vercel.app):** run it locally with `LLM_PROVIDER=replay npm run dev`.

- **No model behind it.** Four sample resumes (public, synthetic) are offered. Their reviews were recorded from one real run of the local model each, and are played back in seconds. The page says so.
- **What is live and what is replayed.** The parser view, the checks, quote grounding and the verdict cap run for real. Only the words the model wrote are recorded.
- **Your own PDF still works for the parser view and checks** (up to 4 MB). It is read on the server and not stored, and no model sees it. The reviewer tabs say reviews exist only for the samples.
- **Job matching and the bullet writer** need a model, so they are not in the demo.
- **Recordings go stale on purpose.** A recording matches only the exact prompt it was made for. After changing a persona, a computed fact, the review schema or a sample resume, the test `src/lib/demo/recordings.test.ts` fails until you run `npm run demo:record` (about 20 minutes on the local model) and commit `demo/recordings`. Why it works this way: `DECISIONS.md` 7.6.
- **Settings:** `LLM_PROVIDER=replay`, and `LLM_RECORDINGS_DIR` if the recordings live somewhere other than `demo/recordings`.
- **Deployment:** Vercel, with `LLM_PROVIDER=replay` set in the project. `main` deploys to production and each pull request gets a preview; `main` only changes through PRs that pass CI (typecheck, tests, build).

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm test` | Run unit tests once |
| `npm run test:watch` | Run tests on file change |
| `npm run typecheck` | Type-check without building |
| `npm run build` | Production build |
| `npm run demo:record` | Re-record the demo's sample reviews with the local model |
| `npm run eval` | Review evals on the public fixtures (see [Evals](#evals)) |
| `npm run eval:jobs` | Job-matching evals (see [Job matching evals](#job-matching-evals)) |
| `npm run match` | One job match in the terminal (see [Job matching](#job-matching-phase-2)) |
| `npm run spike:bullets`, `spike:judge`, `spike:proofread` | Measurement scripts for the bullet loop, its judge and the proofreader; results go to `eval-results/` |

## How a review flows

```
Browser                         POST /api/review (Node runtime)
───────                         ───────────────────────────────
pick PDF ──multipart upload──▶  validate size + "%PDF" magic bytes
                                extract text (unpdf / pdf.js)
                                run deterministic checks
         ◀──── extracted ─────  
                                build prompt (persona + sanitized resume)
         ◀── review_started ──  stream from the model with a JSON Schema
                                (once per reviewer: recruiter, hiring manager,
                                 then the proofreader)
         ◀── review_delta × n ─ 
                                log tokens + latency, validate with Zod
         ◀─── review_done ────  (or error)
```

The response is newline-delimited JSON (NDJSON). Event types are defined once in `src/lib/stream/events.ts` and shared by server and client.

## Project layout

```
src/
  app/
    api/                    review, match and bullets routes (all stream NDJSON)
    layout.tsx, page.tsx, globals.css
  components/               UI (ReviewWorkspace is the client entry point)
  hooks/                    One hook per stream (review, match, bullets) over useNdjsonRequest; pure reducers
  lib/
    bullets/                Bullet writer: code checks, then the draft → check → judge → revise loop
    checks/                 Deterministic resume checks and the timeline (no LLM)
    demo/                   The demo's sample resumes
    eval/                   Fixtures, assertions and reports for the evals
    http/                   Shared route helpers
    jobs/                   Requirement extraction and matching
    llm/                    Provider boundary: gemini.ts, ollama.ts, mock.ts, replay.ts, plus structured calls, retry and usage
    pdf/                    Text extraction
    proofread/              The proofreader: model call, labels format, scoring
    review/                 Personas, prompt, output schema, grounding check, reviewers
    stream/                 NDJSON protocol types + readers
    env.ts                  Validated config
demo/recordings/            Recorded model answers for the demo build
fixtures/                   Public synthetic fixtures (fixtures/private/ is gitignored)
scripts/                    Eval runners, match CLI, spikes, demo recorder
```

## Design decisions

- **Deterministic before LLM.** Anything checkable with plain code is checked with plain code: free, instant, repeatable.
- **One schema, two jobs.** `ReviewSchema` (Zod) becomes the JSON Schema sent to the model *and* validates the response.
- **Evidence quotes.** Every strength and issue must quote the resume. This grounds feedback, and the evals check that quotes actually appear in the text.
- **Provider boundary.** App code imports `@/lib/llm`, never a provider directly. `lib/llm/index.ts` is the only file that maps config to a provider; retries, logging, and grounding checks work the same for all of them.
- **Grounding check.** Every evidence quote is checked against the extracted text in code. Quotes that don't appear are shown with a warning, and each review logs a `review_grounding` line with the counts.
- **Resume text is untrusted.** It's wrapped in delimiters, stripped of delimiter look-alikes, and the model is told to report embedded instructions rather than follow them.
- **No numeric score.** LLM scores are poorly calibrated; a yes/maybe/no verdict plus specific findings is more honest.

## Privacy

Resumes are processed in memory and never written to disk or logs. Usage logs contain token counts and timing only.

With `LLM_PROVIDER=ollama`, resumes never leave your machine. With `LLM_PROVIDER=replay` (the demo build) no model is called at all: an uploaded PDF is read on the server for the parser view and checks, and is not stored.

**Gemini free-tier caveat:** Google may use free-tier content to improve its products. Use it only with your own or sample resumes. Before real users upload resumes, the hosted path needs a paid tier, bring-your-own-key, or similar (decided in Phase 5).

## Troubleshooting

- **"Can't reach Ollama".** Start it with `ollama serve`. If it's running, check `OLLAMA_BASE_URL` (use `127.0.0.1`, not `localhost`).
- **"Ollama doesn't have the model".** Run the `ollama pull` command shown in the error.
- **Settings change had no effect.** Restart `npm run dev`.
- **"rate limit" errors.** The free tier caps requests per minute and per day. Wait and retry.
- **API rejects the response schema.** Gemini supports a subset of JSON Schema. Check the schema `toProviderSchema()` in `src/lib/llm/structured.ts` produces (e.g. `additionalProperties`) against the current Gemini structured-output docs.
- **Model not found.** Model names change. Check AI Studio for current free-tier models and update `GEMINI_MODEL`.
- **PDF can't be read.** Password-protected and some malformed PDFs fail extraction. Scanned PDFs extract but contain almost no text; the "Selectable text" check flags that.

## Evals

`npm run eval` runs the real review pipeline (the same `runReview` the API route uses) against fixture resumes, several times each, and reports how often each expectation holds.

```bash
npm run eval                          # every fixture, 3 runs each
npm run eval -- --runs 1              # quick pass
npm run eval -- --only recent-gap     # one fixture
LLM_PROVIDER=mock npm run eval        # check the runner itself, instantly
```

Each fixture is a resume (`.txt` or `.pdf`) plus a `*.eval.json` file describing what a good review must and must not do:

| Expectation | Meaning |
| --- | --- |
| `verdictIn` | Verdicts a reasonable reviewer could give |
| `mustMention` | Problems that must be raised, by keyword. `minSeverity` limits it to issues at that severity or higher |
| `mustNotMention` | Words the reviewer must never use (quotes from the resume are not searched) |
| `strengthEvidenceNotIn` | Passages, like a self-written summary, that must not be quoted as proof of a strength |

Keywords match whole words, case-insensitively; end one with `*` to match a prefix (`quantif*`). Keyword checks reliably catch "never mentioned the gap", but not "mentioned it badly". That needs a model as judge, which comes later.

Evals use public synthetic fixtures only (`fixtures/*.eval.json`). Results are written to `eval-results/` (gitignored) with the git commit, so you can compare numbers before and after a prompt change. Plain `npm run eval` runs the recruiter, then the proofreader on `fixtures/*.labels.json`; `--persona hiring-manager` runs one persona.

On a local 8B model, expect about 90 seconds per review per persona, so a full run over every fixture takes a long time (tens of minutes). Try `--runs 1` or `--only` first.

## Job matching (Phase 2)

Two steps, both plain structured calls (see `DECISIONS.md` §6 for why this is a workflow, not an agent):

1. `lib/jobs/extract.ts` pulls requirements out of a posting, each tagged `required`, `preferred`, or `bonus`, and checks every one is word for word from the posting.
2. `lib/jobs/match.ts` matches them against the full resume in one call, with years of experience computed in code. Each requirement comes back `met`, `partial`, or `missing`, with a quote checked against the resume.

In the app, choose a resume, open **Match to a job**, and paste a posting. Requirements appear as they're found, then each one fills in as it's checked: the server reads complete items out of the model's JSON as it streams (`lib/stream/json-items.ts`), validates each one, and sends it as its own event. The final validated report replaces the streamed items when it arrives.

Try it from the terminal on a real pair:

```bash
npm run match -- --resume fixtures/private/my-resume.pdf --job fixtures/private/jobs/job-1.txt
```

### Job matching evals

`npm run eval:jobs` measures job matching against `*.job.json` fixtures in `fixtures/jobs/` and `fixtures/private/jobs/`. Each fixture lists the posting's requirements (word for word, with tiers) and the statuses a careful reader of the resume could give each one. Expected statuses reflect what the resume shows, not what the candidate knows.

```bash
npm run eval:jobs                         # matching, against the fixture's saved requirement list
npm run eval:jobs -- --stage extract      # extraction: recall, tiers, no boilerplate, word for word
npm run eval:jobs -- --stage both --only job-1 --runs 5
```

Matching runs against the saved list rather than a fresh extraction, so the two steps can't mask each other's failures.

## Bullet writer (Phase 2)

Next to any job requirement marked **Partly** or **Not shown**, **Write a bullet for this** opens a panel that turns your own notes into candidate bullets. It's an evaluator–optimizer loop (`lib/bullets/loop.ts`): one call drafts up to three candidates from different angles; each is checked in code (no numbers, names, or terms your notes don't contain; length; your style rules) and then by a model judge; failing candidates are revised with their specific failures. Only candidates that pass every check are shown. You pick, edit, and copy; edits are checked against your notes too.

Your writing style (words you don't use, your replacements, keeping code syntax out) is saved in your browser. Notes are used for one request and never stored.
