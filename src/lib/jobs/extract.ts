import { callStructured, type StructuredOutcome } from '@/lib/llm/structured';
import { isQuoteInText, normalizeForMatch } from '@/lib/review/grounding';
import { createArrayItemReader } from '@/lib/stream/json-items';
import { buildExtractionPrompt } from './prompt';
import { ExtractedItemSchema, ExtractionSchema, type Requirement, type Tier } from './schema';

export interface ExtractOptions {
  signal?: AbortSignal;
  log?: boolean;
  /**
   * Called with each requirement as soon as the model finishes writing it,
   * already numbered and checked against the posting. The final result has the
   * same requirements with the same ids.
   */
  onRequirement?: (requirement: Requirement) => void;
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

  let onDelta: ((text: string) => void) | undefined;
  if (options.onRequirement) {
    const reader = createArrayItemReader('requirements');
    const collector = createRequirementCollector(posting);
    const emit = options.onRequirement;
    onDelta = (text) => {
      for (const item of reader.push(text)) {
        const parsed = ExtractedItemSchema.safeParse(item);
        const requirement = parsed.success ? collector.add(parsed.data) : null;
        if (requirement) emit(requirement);
      }
    };
  }

  const outcome = await callStructured({
    task: 'job:extract',
    system,
    user,
    schema: ExtractionSchema,
    temperature: 0.1,
    signal: options.signal,
    log: options.log,
    onDelta,
    mockResponse: () => mockExtraction(posting),
  });
  if (!outcome.ok) return outcome;
  return { ok: true, data: finalizeRequirements(outcome.data.requirements, posting), call: outcome.call };
}

/**
 * Numbers requirements, drops empty and duplicate entries, and checks each
 * against the posting, one at a time. Streaming and the final result use the
 * same collector, so ids always agree.
 */
export function createRequirementCollector(posting: string) {
  const seen = new Set<string>();
  let nextId = 1;
  return {
    add(item: { text: string; tier: Tier }): Requirement | null {
      const text = item.text.trim();
      const key = normalizeForMatch(text);
      if (!key || seen.has(key)) return null;
      seen.add(key);
      return { id: nextId++, text, tier: item.tier, foundInPosting: isQuoteInText(text, posting) };
    },
  };
}

export function finalizeRequirements(raw: { text: string; tier: Tier }[], posting: string): Requirement[] {
  const collector = createRequirementCollector(posting);
  return raw.map((item) => collector.add(item)).filter((r): r is Requirement => r !== null);
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
