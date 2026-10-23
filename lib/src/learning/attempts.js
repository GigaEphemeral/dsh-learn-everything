// Append-only attempt records (S2). Every answer is persisted; history is
// never rewritten. Links to the exact question version that was answered.
import { ATTEMPT_RESULTS, PRACTICE_PHASES, isAttemptResult, isPracticePhase } from './types.js';
import { safeLimit } from './limits.js';
import { toCanonicalIso } from './time.js';
function requireNonEmptyString(field, value) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`attempt.record requires a non-empty ${field}`);
    }
    return value;
}
function requireResult(value) {
    // Keep the "non-empty" wording for a missing value (callers/regression tests
    // distinguish missing from out-of-domain).
    requireNonEmptyString('result', value);
    if (!isAttemptResult(value)) {
        throw new Error(`invalid attempt result "${String(value)}"; expected one of ${ATTEMPT_RESULTS.join('|')}`);
    }
    return value;
}
function requirePhase(value) {
    if (!isPracticePhase(value)) {
        throw new Error(`invalid practice phase "${String(value)}"; expected one of ${PRACTICE_PHASES.join('|')}`);
    }
    return value;
}
function requireQuestionVersion(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('attempt.record requires a finite questionVersion');
    }
    return value;
}
// A caller-supplied answer time must be indistinguishable from what the store
// writes itself, otherwise recentFor's answered_at ordering would mix two
// timestamp shapes and mis-order history.
function requireAnsweredAt(value) {
    return toCanonicalIso(value, 'attempt.record answeredAt');
}
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
export class AttemptStore {
    ldb;
    constructor(ldb) {
        this.ldb = ldb;
    }
    record(a) {
        const attemptId = requireNonEmptyString('attemptId', a.attemptId);
        const questionId = requireNonEmptyString('questionId', a.questionId);
        const questionVersion = requireQuestionVersion(a.questionVersion);
        const result = requireResult(a.result);
        // Optional fields are normalised to null so an omitted value never reaches
        // the binding layer as `undefined` (node:sqlite throws on undefined binds).
        const score = a.score === undefined ? null : a.score;
        const answerSummary = a.answerSummary === undefined ? null : a.answerSummary;
        const phase = a.phase === undefined ? 'first' : requirePhase(a.phase);
        const answeredAt = a.answeredAt === undefined ? new Date().toISOString() : requireAnsweredAt(a.answeredAt);
        try {
            this.ldb.db
                .prepare('INSERT INTO attempts (attempt_id, question_id, question_version, answered_at, result, score, answer_summary, phase) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .run(attemptId, questionId, questionVersion, answeredAt, result, score, answerSummary, phase);
        }
        catch (err) {
            // Keep the raw constraint/IO cause but make the failure attributable.
            throw new Error(`failed to record attempt ${attemptId} for question ${questionId} (version ${questionVersion}): ${errorMessage(err)}`, { cause: err });
        }
    }
    // Newest answer first by wall-clock time, not by insert order: backfilled
    // rows inserted later must not jump ahead of answers given after them (A11).
    // Insert id is only the tie-breaker for identical timestamps.
    recentFor(questionId, limit = 10) {
        return this.ldb.db
            .prepare('SELECT attempt_id, question_id, question_version, answered_at, result, score, answer_summary, phase FROM attempts WHERE question_id = ? ORDER BY answered_at DESC, id DESC LIMIT ?')
            .all(questionId, safeLimit(limit, 10));
    }
    count() {
        const row = this.ldb.db.prepare('SELECT COUNT(*) AS n FROM attempts').get();
        return row.n;
    }
}
