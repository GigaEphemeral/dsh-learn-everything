// Shared learning-domain unions. This is a leaf module (no imports) so stores
// and the practice orchestrator can share types without circular dependencies.
// The unions are mirrored by CHECK constraints in schema v2.

export const ATTEMPT_RESULTS = ['correct', 'incorrect', 'partial'] as const;
export type AttemptResult = (typeof ATTEMPT_RESULTS)[number];

export const PRACTICE_PHASES = ['first', 'correction', 'variant'] as const;
export type PracticePhase = (typeof PRACTICE_PHASES)[number];

export function isAttemptResult(value: unknown): value is AttemptResult {
  return typeof value === 'string' && (ATTEMPT_RESULTS as readonly string[]).includes(value);
}

export function isPracticePhase(value: unknown): value is PracticePhase {
  return typeof value === 'string' && (PRACTICE_PHASES as readonly string[]).includes(value);
}
