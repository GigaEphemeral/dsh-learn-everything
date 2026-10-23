// Shared learning-domain unions. This is a leaf module (no imports) so stores
// and the practice orchestrator can share types without circular dependencies.
// The unions are mirrored by CHECK constraints in schema v2.
export const ATTEMPT_RESULTS = ['correct', 'incorrect', 'partial'];
export const PRACTICE_PHASES = ['first', 'correction', 'variant'];
export function isAttemptResult(value) {
    return typeof value === 'string' && ATTEMPT_RESULTS.includes(value);
}
export function isPracticePhase(value) {
    return typeof value === 'string' && PRACTICE_PHASES.includes(value);
}
