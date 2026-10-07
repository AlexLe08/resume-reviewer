# Resume Reviewer

Shows job seekers two things about their resume:

1. **What a parser sees.** The plain text software extracts from the PDF, plus deterministic checks (selectable text, contact info, standard sections, length).
2. **How reviewers read it.** Structured feedback from reviewer personas, with every point backed by a quote from the resume.

Phase 1 ships one reviewer (Recruiter). More personas, job-description matching, and evals come in later phases.

## Getting started

Requires Node 20.9+ (22 recommended, see `.nvmrc`).

```bash
npm install
cp .env.example .env.local   # then add your Gemini API key
npm run dev                  # http://localhost:3000
```

Get a free Gemini API key from [Google AI Studio](https://aistudio.google.com). No card required.

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
    llm/                    Provider boundary. Only gemini.ts knows about Gemini
    pdf/                    Text extraction
    review/                 Personas, prompt building, output schema
    stream/                 NDJSON protocol types + reader
    env.ts                  Validated config
```

## Design decisions

- **Deterministic before LLM.** Anything checkable with plain code is checked with plain code: free, instant, repeatable.
- **One schema, two jobs.** `ReviewSchema` (Zod) becomes the JSON Schema sent to the model *and* validates the response.
- **Evidence quotes.** Every strength and issue must quote the resume. This grounds feedback and lets a future eval verify quotes actually appear in the text.
- **Provider boundary.** App code imports `@/lib/llm`, never the Gemini SDK, so swapping or adding providers stays contained.
- **Resume text is untrusted.** It's wrapped in delimiters, stripped of delimiter look-alikes, and the model is told to report embedded instructions rather than follow them.
- **No numeric score.** LLM scores are poorly calibrated; a yes/maybe/no verdict plus specific findings is more honest.

## Privacy

Resumes are processed in memory and never written to disk or logs. Usage logs contain token counts and timing only.

**Free-tier caveat:** on the Gemini free tier, Google may use submitted content to improve its products. That's acceptable for development with your own or sample resumes. Before real users upload resumes, move to a paid tier, bring-your-own-key, or a local model.

## Troubleshooting

- **"rate limit" errors.** The free tier caps requests per minute and per day. Wait and retry.
- **API rejects the response schema.** Gemini supports a subset of JSON Schema. Check `reviewJsonSchema()` output (e.g. `additionalProperties`) against the current Gemini structured-output docs.
- **Model not found.** Model names change. Check AI Studio for current free-tier models and update `GEMINI_MODEL`.
- **PDF can't be read.** Password-protected and some malformed PDFs fail extraction. Scanned PDFs extract but contain almost no text; the "Selectable text" check flags that.
