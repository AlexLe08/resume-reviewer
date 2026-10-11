import type { MatchReport, Requirement, RequirementMatch } from '@/lib/jobs/schema';
import type { CallRecord } from '@/lib/llm/usage';

/**
 * The /api/match stream, shared by server and client.
 * resume_read → requirement* → requirements_done → match* → match_done (or error).
 * Streamed items are provisional; the *_done events carry the validated result.
 */
export type MatchStreamEvent =
  | { type: 'resume_read'; pageCount: number }
  | { type: 'requirement'; requirement: Requirement }
  | { type: 'requirements_done'; requirements: Requirement[]; call: CallRecord }
  | { type: 'match'; match: RequirementMatch }
  | { type: 'match_done'; report: MatchReport; call: CallRecord }
  | { type: 'error'; stage: 'requirements' | 'match'; message: string; retryable: boolean };
