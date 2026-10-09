/**
 * SPIKE (Phase 2): does a tool-calling agent beat a single call that simply
 * reads the whole resume?
 *
 * A spike answers one question and is then replaced by real code.
 *
 *   agent   The resume is hidden; the model can only see it through tools.
 *   direct  No tools; the whole resume is in the prompt, one structured call.
 *
 * Same requirements, same scoring, so the two modes can be compared directly.
 * It talks to Ollama directly, bypassing lib/llm on purpose: our provider
 * interface has no concept of tools yet.
 *
 *   npm run spike:tools                       agent mode, 5 runs
 *   npm run spike:tools -- --mode direct      direct mode
 *   npm run spike:tools -- --runs 3
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { analyzeTimeline, formatDuration } from '@/lib/checks/timeline'
import { getEnv } from '@/lib/env'
import { isQuoteInText, normalizeForMatch } from '@/lib/review/grounding'

type Status = 'met' | 'partial' | 'missing'

// Each requirement is worded differently from fixtures/strong-frontend.txt, as real postings are.
const REQUIREMENTS: { text: string; expected: Status }[] = [
  // Resume says "shared component library adopted by 9 product teams". A search for "design system" finds nothing useful.
  { text: 'Experience building and maintaining a design system', expected: 'met' },
  // Resume says "accessibility issues" and "WCAG 2.1 AA", never "disabilities".
  { text: 'Experience making interfaces usable for people with disabilities', expected: 'met' },
  // GraphQL appears only in the skills list, with no experience behind it.
  { text: 'Hands-on GraphQL API work', expected: 'partial' },
  // The real evidence is "Reduced median mobile page load from 4.1 s to 2.3 s"; "Web Performance" in skills is weaker.
  { text: 'Track record of improving web performance', expected: 'met' },
  // Nothing on the resume.
  { text: 'Native mobile development (iOS or Android)', expected: 'missing' },
]

const MAX_STEPS = 8

const STATUS_MEANINGS =
  'Status meanings: "met" = shown in work experience; "partial" = only listed (e.g. in skills) without experience to back it; "missing" = not found.'

const requirementsText = () =>
  `Requirements:\n${REQUIREMENTS.map((r, i) => `${i + 1}. ${r.text}`).join('\n')}`

interface ToolCall {
  function: { name: string; arguments?: Record<string, unknown> | string }
}

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_name?: string
}

interface Tool {
  name: string
  description: string
  parameters: Record<string, unknown>
  run: (args: Record<string, unknown>) => string
}

function makeTools(resume: string, today: Date): Tool[] {
  const lines = resume
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const isHeading = (line: string) => /^[A-Z][A-Z &]{2,40}$/.test(line)
  const monthIndex = (ym: { year: number; month: number }) => ym.year * 12 + ym.month

  return [
    {
      name: 'search_resume',
      description:
        'Find resume lines containing any of the words in the query. Returns up to 6 matching lines, word for word.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to look for, e.g. "kubernetes docker"' },
        },
        required: ['query'],
      },
      run: (args) => {
        if (typeof args.query !== 'string' || !args.query.trim())
          throw new Error('query must be a non-empty string')
        const words = args.query
          .toLowerCase()
          .split(/[^a-z0-9.+#]+/)
          .filter((w) => w.length > 1)
        const hits = lines
          .filter((line) => words.some((w) => line.toLowerCase().includes(w)))
          .slice(0, 6)
        return hits.length > 0 ? hits.join('\n') : 'No matching lines.'
      },
    },
    {
      name: 'get_section',
      description: 'Return one whole section of the resume, word for word.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: ['summary', 'experience', 'skills', 'education'] },
        },
        required: ['name'],
      },
      run: (args) => {
        const name = String(args.name ?? '').toUpperCase()
        const start = lines.findIndex((line) => isHeading(line) && line.includes(name))
        if (start === -1) return `No section named "${String(args.name)}".`
        const end = lines.findIndex((line, i) => i > start && isHeading(line))
        return lines.slice(start + 1, end === -1 ? undefined : end).join('\n')
      },
    },
    {
      name: 'years_of_experience',
      description:
        'Compute the time from the earliest start date to the latest end date on the resume. Use this instead of doing date math yourself.',
      parameters: { type: 'object', properties: {} },
      run: () => {
        const { ranges } = analyzeTimeline(resume, today)
        if (ranges.length === 0) return 'No date ranges found on the resume.'
        const now = monthIndex({ year: today.getFullYear(), month: today.getMonth() + 1 })
        const start = Math.min(...ranges.map((r) => monthIndex(r.start)))
        const end = Math.max(...ranges.map((r) => (r.end === 'present' ? now : monthIndex(r.end))))
        const ongoing = ranges.some((r) => r.end === 'present')
        return `From the earliest start date to ${ongoing ? 'the present' : 'the latest end date'}: ${formatDuration(end - start)}.`
      },
    },
  ]
}

const AGENT_SYSTEM = [
  'You check a resume against job requirements.',
  'You cannot see the resume directly. Use the tools to find evidence for every requirement; never guess.',
  'Job postings often use different words than resumes. If a search finds nothing, try other words before deciding a requirement is missing.',
  'For years of experience, call years_of_experience instead of calculating.',
  STATUS_MEANINGS,
  'When every requirement is checked, reply with only this JSON and nothing else:',
  '{"results":[{"requirement":"<the requirement text exactly as given>","status":"met", "partial" or "missing","evidence":"<text copied from a tool result, or empty if missing>"}]}',
].join('\n')

const DIRECT_SYSTEM = [
  'You check a resume against job requirements.',
  'Job postings often use different words than resumes; match on meaning, not exact wording.',
  STATUS_MEANINGS,
  'Evidence must be copied word for word from the resume, or empty if missing.',
  'Keep each requirement text exactly as given.',
].join('\n')

const RESULTS_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          requirement: { type: 'string' },
          status: { type: 'string', enum: ['met', 'partial', 'missing'] },
          evidence: { type: 'string' },
        },
        required: ['requirement', 'status', 'evidence'],
      },
    },
  },
  required: ['results'],
}

interface RunResult {
  steps: number
  calls: string[]
  invalidCalls: number
  finished: boolean
  toolCallWrittenAsText: boolean
  validJson: boolean
  correct: number
  evidenceChecked: number
  evidenceGrounded: number
  emptySearches: number
  searchedAgainAfterEmpty: number
  perRequirement: { status: string; correct: boolean }[]
  latencyMs: number
}

function emptyResult(): RunResult {
  return {
    steps: 0,
    calls: [],
    invalidCalls: 0,
    finished: false,
    toolCallWrittenAsText: false,
    validJson: false,
    correct: 0,
    evidenceChecked: 0,
    evidenceGrounded: 0,
    emptySearches: 0,
    searchedAgainAfterEmpty: 0,
    perRequirement: [],
    latencyMs: 0,
  }
}

async function chat(baseUrl: string, body: Record<string, unknown>): Promise<Message> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stream: false, ...body }),
  })
  if (!res.ok) {
    const detail = await res.text()
    if (/does not support tools/i.test(detail)) {
      throw new Error(`"${String(body.model)}" doesn't support tool calling in Ollama.`)
    }
    throw new Error(`Ollama returned ${res.status}: ${detail.slice(0, 300)}`)
  }
  return ((await res.json()) as { message: Message }).message
}

async function runAgent(
  resume: string,
  baseUrl: string,
  model: string,
  numCtx: number
): Promise<RunResult> {
  const tools = makeTools(resume, new Date())
  const toolSchemas = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
  const messages: Message[] = [
    { role: 'system', content: AGENT_SYSTEM },
    { role: 'user', content: requirementsText() },
  ]
  const toolOutputs: string[] = []
  const result = emptyResult()
  const started = performance.now()
  let finalText = ''
  let lastSearchWasEmpty = false

  for (let step = 1; step <= MAX_STEPS; step++) {
    result.steps = step
    const message = await chat(baseUrl, {
      model,
      messages,
      tools: toolSchemas,
      options: { temperature: 0.2, num_ctx: numCtx },
    })
    messages.push(message)
    const calls = message.tool_calls ?? []

    if (calls.length === 0) {
      finalText = message.content
      result.finished = true
      break
    }

    for (const call of calls) {
      const name = call.function.name
      if (name === 'search_resume' && lastSearchWasEmpty) {
        result.searchedAgainAfterEmpty++
        lastSearchWasEmpty = false
      }
      const tool = tools.find((t) => t.name === name)
      let output: string
      try {
        if (!tool) throw new Error(`unknown tool "${name}"`)
        const raw = call.function.arguments ?? {}
        const args = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : raw
        output = tool.run(args)
        result.calls.push(`${name}(${JSON.stringify(args)})`)
      } catch (err) {
        result.invalidCalls++
        output = `Error: ${err instanceof Error ? err.message : String(err)}`
        result.calls.push(`${name} → ${output}`)
      }
      if (name === 'search_resume' && output === 'No matching lines.') {
        result.emptySearches++
        lastSearchWasEmpty = true
      }
      toolOutputs.push(output)
      // Show what the tool returned, not just the call: misleading results are a failure mode too.
      console.log(
        `    ${result.calls.at(-1)}\n      ↳ ${output.split('\n')[0]?.slice(0, 90)}${output.includes('\n') ? ' (+more)' : ''}`
      )
      messages.push({ role: 'tool', tool_name: name, content: output })
    }
  }

  result.latencyMs = Math.round(performance.now() - started)
  // Some models write the tool call as text instead of making it. Worth knowing about separately.
  result.toolCallWrittenAsText =
    /"name"\s*:\s*"(search_resume|get_section|years_of_experience)"/.test(finalText)
  score(finalText, toolOutputs.join('\n'), result)
  return result
}

async function runDirect(
  resume: string,
  baseUrl: string,
  model: string,
  numCtx: number
): Promise<RunResult> {
  const result = emptyResult()
  const started = performance.now()
  const message = await chat(baseUrl, {
    model,
    format: RESULTS_SCHEMA,
    options: { temperature: 0.2, num_ctx: numCtx },
    messages: [
      { role: 'system', content: DIRECT_SYSTEM },
      { role: 'user', content: `${requirementsText()}\n\n<resume>\n${resume}\n</resume>` },
    ],
  })
  result.steps = 1
  result.finished = true
  result.latencyMs = Math.round(performance.now() - started)
  score(message.content, resume, result)
  return result
}

/** Scores a final answer. Evidence must appear in `evidencePool`: tool output for the agent, the resume for direct mode. */
function score(finalText: string, evidencePool: string, result: RunResult): void {
  const answers = parseFinal(finalText)
  if (!answers) {
    if (finalText)
      console.log(
        `    final reply was not valid JSON: ${finalText.slice(0, 160).replace(/\s+/g, ' ')}…`
      )
    return
  }
  result.validJson = true
  REQUIREMENTS.forEach((req, i) => {
    const answer =
      answers.find(
        (a) => normalizeForMatch(String(a.requirement ?? '')) === normalizeForMatch(req.text)
      ) ?? answers[i]
    const status = String(answer?.status ?? 'none')
    const evidence = String(answer?.evidence ?? '')
    const correct = status === req.expected
    if (correct) result.correct++
    if (status === 'met' || status === 'partial') {
      result.evidenceChecked++
      if (evidence.trim() && isQuoteInText(evidence, evidencePool)) result.evidenceGrounded++
    }
    result.perRequirement.push({ status, correct })
    const quote = evidence ? `  ← "${evidence.slice(0, 70)}${evidence.length > 70 ? '…' : ''}"` : ''
    console.log(
      `    ${correct ? '✓' : '✗'} ${status.padEnd(7)} (expected ${req.expected.padEnd(7)}) ${req.text}${quote}`
    )
  })
}

function parseFinal(
  content: string
): { requirement?: unknown; status?: unknown; evidence?: unknown }[] | null {
  const cleaned = content.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try {
    const data = JSON.parse(cleaned.slice(start, end + 1)) as { results?: unknown }
    return Array.isArray(data.results) ? data.results : null
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env.local')
  } catch {
    // Rely on the shell environment.
  }
  const { values } = parseArgs({
    options: { runs: { type: 'string', default: '5' }, mode: { type: 'string', default: 'agent' } },
  })
  const runs = Number(values.runs)
  if (!Number.isInteger(runs) || runs < 1)
    throw new Error('--runs must be a positive whole number.')
  if (values.mode !== 'agent' && values.mode !== 'direct')
    throw new Error('--mode must be "agent" or "direct".')
  const mode = values.mode

  const env = getEnv()
  const baseUrl = env.OLLAMA_BASE_URL.replace(/\/+$/, '')
  const resume = await readFile(path.join(process.cwd(), 'fixtures', 'strong-frontend.txt'), 'utf8')
  const runOnce = mode === 'agent' ? runAgent : runDirect

  console.log(`Spike, ${mode} mode: ${runs} run(s) with ollama / ${env.OLLAMA_MODEL}\n`)
  const results: RunResult[] = []
  for (let i = 1; i <= runs; i++) {
    console.log(`  run ${i}/${runs}`)
    const r = await runOnce(resume, baseUrl, env.OLLAMA_MODEL, env.OLLAMA_NUM_CTX)
    results.push(r)
    console.log(
      `    → ${r.finished ? 'answered' : `stopped at ${MAX_STEPS} steps`}, ${r.calls.length} tool call(s), ` +
        `JSON ${r.validJson ? 'ok' : 'missing'}, ${r.correct}/${REQUIREMENTS.length} correct, ${(r.latencyMs / 1000).toFixed(1)} s\n`
    )
  }

  const count = (pred: (r: RunResult) => boolean) => results.filter(pred).length
  const total = (pick: (r: RunResult) => number) => results.reduce((sum, r) => sum + pick(r), 0)
  const times = results.map((r) => r.latencyMs).sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)] ?? 0

  console.log(`Summary (${mode})`)
  console.log(`  finished within ${MAX_STEPS} steps      ${count((r) => r.finished)}/${runs}`)
  console.log(`  valid final JSON              ${count((r) => r.validJson)}/${runs}`)
  console.log(
    `  requirement verdicts correct  ${total((r) => r.correct)}/${runs * REQUIREMENTS.length}`
  )
  console.log(
    `  evidence grounded             ${total((r) => r.evidenceGrounded)}/${total((r) => r.evidenceChecked)}`
  )
  if (mode === 'agent') {
    console.log(
      `  tool calls per run (avg)      ${(total((r) => r.calls.length) / runs).toFixed(1)}`
    )
    console.log(`  invalid tool calls            ${total((r) => r.invalidCalls)}`)
    console.log(`  tool call written as text     ${count((r) => r.toolCallWrittenAsText)}/${runs}`)
    console.log(`  empty searches                ${total((r) => r.emptySearches)}`)
    console.log(`  searched again after empty    ${total((r) => r.searchedAgainAfterEmpty)}`)
  }
  console.log(`  median time                   ${(median / 1000).toFixed(1)} s`)

  console.log('\nPer requirement')
  REQUIREMENTS.forEach((req, i) => {
    const got = results.map((r) => r.perRequirement[i])
    const correct = got.filter((g) => g?.correct).length
    console.log(
      `  ${correct}/${runs}  ${req.text}  [${got.map((g) => g?.status ?? '—').join(', ')}]`
    )
  })
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
