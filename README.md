# Resume Reviewer

Shows job seekers two things about their resume:

1. **What a parser sees.** The plain text software extracts from the PDF, plus deterministic checks (selectable text, contact info, standard sections, length).
2. **How reviewers read it.** Structured feedback from reviewer personas, with every point backed by a quote from the resume.

Phase 1 ships one reviewer (Recruiter). More personas, job-description matching, and evals come in later phases.

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

### Ollama setup (macOS)

```bash
brew install ollama
ollama serve                 # leave running in its own terminal
ollama pull gemma4:e4b-it-q4_K_M # ~8B model at 4-bit, fits 16 GB Apple Silicon
```

Notes:

- Run Ollama natively, not in Docker. Containers on macOS can't use the Apple Silicon GPU.
- On a 16 GB Mac, stop Colima / Docker Desktop / OrbStack while reviewing; an 8B model plus a container VM plus your browser is tight.
- The first request after starting Ollama loads the model into memory and is slow. Later ones are faster until Ollama unloads it after a few idle minutes.
- To try another model: `ollama pull <name>`, set `OLLAMA_MODEL`, restart the dev server. Compare models with the "Quotes found in resume" number, not by feel.

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm test` | Run unit tests once |
| `npm run test:watch` | Run tests on file change |
| `npm run typecheck` | Type-check without building |
| `npm run build` | Production build |

## How a review flows

```
Browser                         POST /api/review (Node runtime)
───────                         ───────────────────────────────
pick PDF ──multipart upload──▶  validate size + "%PDF" magic bytes
                                extract text (unpdf / pdf.js)
                                run deterministic checks
         ◀──── extracted ─────  
                                build prompt (persona + sanitized resume)
         ◀── review_started ──  stream from Gemini with a JSON Schema
         ◀── review_delta × n ─ 
                                log tokens + latency, validate with Zod
         ◀─── review_done ────  (or error)
```

The response is newline-delimited JSON (NDJSON). Event types are defined once in `src/lib/stream/events.ts` and shared by server and client.

## Project layout

```
src/
  app/
    api/review/route.ts     The only API endpoint
    layout.tsx, page.tsx, globals.css
  components/               UI (ReviewWorkspace is the client entry point)
  hooks/useReviewStream.ts  Fetch + stream reading + a pure state reducer
  lib/
    checks/                 Deterministic resume checks (no LLM)
    llm/                    Provider boundary: gemini.ts, ollama.ts, mock.ts, plus retry + usage
    pdf/                    Text extraction
    review/                 Personas, prompt, output schema, grounding check, mock review
    stream/                 NDJSON protocol types + reader
    env.ts                  Validated config
```

## Design decisions

- **Deterministic before LLM.** Anything checkable with plain code is checked with plain code: free, instant, repeatable.
- **One schema, two jobs.** `ReviewSchema` (Zod) becomes the JSON Schema sent to the model *and* validates the response.
- **Evidence quotes.** Every strength and issue must quote the resume. This grounds feedback and lets a future eval verify quotes actually appear in the text.
- **Provider boundary.** App code imports `@/lib/llm`, never a provider directly. `lib/llm/index.ts` is the only file that maps config to a provider; retries, logging, and grounding checks work the same for all of them.
- **Grounding check.** Every evidence quote is checked against the extracted text in code. Quotes that don't appear are shown with a warning, and each review logs a `review_grounding` line with the counts.
- **Resume text is untrusted.** It's wrapped in delimiters, stripped of delimiter look-alikes, and the model is told to report embedded instructions rather than follow them.
- **No numeric score.** LLM scores are poorly calibrated; a yes/maybe/no verdict plus specific findings is more honest.

## Privacy

Resumes are processed in memory and never written to disk or logs. Usage logs contain token counts and timing only.

With `LLM_PROVIDER=ollama`, resumes never leave your machine.

**Gemini free-tier caveat:** Google may use free-tier content to improve its products. Use it only with your own or sample resumes. Before real users upload resumes, the hosted path needs a paid tier, bring-your-own-key, or similar (decided in Phase 5).

## Troubleshooting

- **"Can't reach Ollama".** Start it with `ollama serve`. If it's running, check `OLLAMA_BASE_URL` (use `127.0.0.1`, not `localhost`).
- **"Ollama doesn't have the model".** Run the `ollama pull` command shown in the error.
- **Settings change had no effect.** Restart `npm run dev`.
- **"rate limit" errors.** The free tier caps requests per minute and per day. Wait and retry.
- **API rejects the response schema.** Gemini supports a subset of JSON Schema. Check `reviewJsonSchema()` output (e.g. `additionalProperties`) against the current Gemini structured-output docs.
- **Model not found.** Model names change. Check AI Studio for current free-tier models and update `GEMINI_MODEL`.
- **PDF can't be read.** Password-protected and some malformed PDFs fail extraction. Scanned PDFs extract but contain almost no text; the "Selectable text" check flags that.
