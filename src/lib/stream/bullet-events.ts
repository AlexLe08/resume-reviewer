import type { CheckResult } from '@/lib/bullets/checks';

/**
 * The /api/bullets stream, shared by server and client.
 * drafted → (round* → candidate_done) per candidate → done (or error).
 */
export type BulletStreamEvent =
  | { type: 'drafted'; candidates: { angle: string; bullet: string }[]; questions: string[] }
  | { type: 'round'; index: number; roundIndex: number; draft: string; passed: boolean; failing: CheckResult['id'][] }
  | { type: 'candidate_done'; index: number; status: 'passed' | 'failed'; bullet: string }
  | { type: 'done' }
  | { type: 'error'; message: string; retryable: boolean };
