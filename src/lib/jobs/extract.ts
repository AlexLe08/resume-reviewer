import { callStructured, type StructuredOutcome } from '@/lib/llm/structured';
import { isQuoteInText, normalizeForMatch } from '@/lib/review/grounding';
import { buildExtractionPrompt } from './prompt';
import { ExtractionSchema, type Requirement, type Tier } from './schema';

export interface ExtractOptions {
  signal?: AbortSignal;
  log?: boolean;
}

/**
 * Step 1 of job matching: pull the requirements out of a posting.
 *
 * Postings vary too much in layout for reliable rules (headings with and
 * without colons, paragraphs, "you might be a fit if…"), so a model does the
 * finding. Code then checks each requirement is really in the posting, the
 * same way quotes are checked in reviews, so a reworded or invented
 * requirement is flagged, not trusted.
 */
export async function extractRequirements(
  posting: string,
  options: ExtractOptions = {},
): Promise<StructuredOutcome<Requirement[]>> {
  const { system, user } = buildExtractionPrompt(posting);
  const outcome = await callStructured({
    task: 'job:extract',
    system,
    user,
    schema: ExtractionSchema,
    temperature: 0.1,
    signal: options.signal,
    log: options.log,
    mockResponse: () => mockExtraction(posting),
  });
  if (!outcome.ok) return outcome;
  return { ok: true, data: finalizeRequirements(outcome.data.requirements, posting), call: outcome.call };
}

/** Drops empty and duplicate entries, numbers them, and checks each against the posting. */
export function finalizeRequirements(raw: { text: string; tier: Tier }[], posting: string): Requirement[] {
  const seen = new Set<string>();
  const requirements: Requirement[] = [];
  for (const item of raw) {
    const text = item.text.trim();
    const key = normalizeForMatch(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    requirements.push({ id: requirements.length + 1, text, tier: item.tier, foundInPosting: isQuoteInText(text, posting) });
  }
  return requirements;
}

/** For the mock provider: a few real lines from the posting, so downstream code has something to work with. */
function mockExtraction(posting: string): { requirements: { text: string; tier: Tier }[] } {
  const lines = posting
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /experience|knowledge|familiarity|proficien|degree/i.test(line) && line.length < 300);
  return {
    requirements: lines.slice(0, 6).map((text, i) => ({ text, tier: i < 4 ? 'required' : 'bonus' })),
  };
}
