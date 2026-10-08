import type { ExtractedDocument } from '@/lib/pdf/extract';
import { analyzeTimeline, checkTimeline } from './timeline';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

/**
 * Deterministic checks: plain code, no LLM. They're free, instant, and always
 * give the same answer, so anything we CAN check this way, we should.
 */
export function runChecks(doc: ExtractedDocument, today: Date = new Date()): CheckResult[] {
  return [
    checkExtractableText(doc),
    checkEmail(doc.text),
    checkPhone(doc.text),
    checkSections(doc.text),
    checkLength(doc),
    checkTimeline(analyzeTimeline(doc.text, today)),
  ];
}

const MIN_CHARS_PER_PAGE = 200;

export function hasUsableText(doc: ExtractedDocument): boolean {
  const pages = Math.max(doc.pageCount, 1);
  return doc.text.length / pages >= MIN_CHARS_PER_PAGE;
}

function checkExtractableText(doc: ExtractedDocument): CheckResult {
  const base = { id: 'extractable-text', label: 'Selectable text' };
  if (!hasUsableText(doc)) {
    return {
      ...base,
      status: 'fail',
      detail:
        'Almost no text could be pulled from this PDF. It is probably a scan or was exported as images, so an ATS would see a nearly empty resume. Export it again from your editor as a text PDF.',
    };
  }
  return { ...base, status: 'pass', detail: 'The text in this PDF can be read by software.' };
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function findEmail(text: string): string | null {
  return text.match(EMAIL)?.[0] ?? null;
}

function checkEmail(text: string): CheckResult {
  const email = findEmail(text);
  return email
    ? { id: 'email', label: 'Email address', status: 'pass', detail: `Found ${email}.` }
    : {
        id: 'email',
        label: 'Email address',
        status: 'fail',
        detail:
          'No email address found in the text. If it is in a page header, footer, or image, move it into the body of the resume.',
      };
}

// Broad first pass, then filter by digit count. Deliberately loose so it
// handles international formats; the filter rejects things like "2019 - 2021".
const PHONE_CANDIDATE = /\+?\(?\d[\d\s().-]{8,}\d/g;
const YEAR_RANGE = /\b(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}\b/;

export function findPhone(text: string): string | null {
  for (const match of text.matchAll(PHONE_CANDIDATE)) {
    const candidate = match[0];
    const digits = candidate.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15 && !YEAR_RANGE.test(candidate)) {
      return candidate.trim();
    }
  }
  return null;
}

function checkPhone(text: string): CheckResult {
  const phone = findPhone(text);
  return phone
    ? { id: 'phone', label: 'Phone number', status: 'pass', detail: `Found ${phone}.` }
    : {
        id: 'phone',
        label: 'Phone number',
        status: 'warn',
        detail:
          'No phone number found in the text. Many application forms ask for it separately, but recruiters often expect it on the resume too.',
      };
}

// Phase 1 heuristic: look for the words anywhere. This is lenient on purpose.
// Real heading detection needs layout information (font size, position),
// which we'll get when extraction returns positioned text.
const STANDARD_SECTIONS = [
  { name: 'Experience', pattern: /\b(experience|employment)\b/i },
  { name: 'Education', pattern: /\beducation\b/i },
  { name: 'Skills', pattern: /\bskills\b/i },
] as const;

export function findMissingSections(text: string): string[] {
  return STANDARD_SECTIONS.filter((s) => !s.pattern.test(text)).map((s) => s.name);
}

function checkSections(text: string): CheckResult {
  const missing = findMissingSections(text);
  if (missing.length === 0) {
    return {
      id: 'sections',
      label: 'Standard sections',
      status: 'pass',
      detail: 'Found Experience, Education, and Skills.',
    };
  }
  return {
    id: 'sections',
    label: 'Standard sections',
    status: 'warn',
    detail: `Couldn't find: ${missing.join(', ')}. Parsers map content into fields using common heading names, so creative headings can leave sections unrecognized.`,
  };
}

function checkLength(doc: ExtractedDocument): CheckResult {
  const base = { id: 'length', label: 'Length' };
  const pages = `${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'}`;
  if (doc.pageCount > 2) {
    return {
      ...base,
      status: 'warn',
      detail: `${pages}. Most recruiters expect one or two pages unless the role calls for a full CV.`,
    };
  }
  return { ...base, status: 'pass', detail: `${pages}.` };
}
