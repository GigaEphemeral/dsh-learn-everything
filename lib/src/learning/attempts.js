// Append-only attempt records (S2). Every answer is persisted; history is
// never rewritten. Links to the exact question version that was answered.
function requireNonEmptyString(field, value) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`attempt.record requires a non-empty ${field}`);
    }
    return value;
}
function requireQuestionVersion(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('attempt.record requires a finite questionVersion');
    }
    return value;
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
        const result = requireNonEmptyString('result', a.result);
        // Optional fields are normalised to null so an omitted value never reaches
        // the binding layer as `undefined` (node:sqlite throws on undefined binds).
        const score = a.score === undefined ? null : a.score;
        const answerSummary = a.answerSummary === undefined ? null : a.answerSummary;
        const phase = a.phase === undefined ? 'first' : a.phase;
        try {
            this.ldb.db
                .prepare('INSERT INTO attempts (attempt_id, question_id, question_version, answered_at, result, score, answer_summary, phase) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .run(attemptId, questionId, questionVersion, new Date().toISOString(), result, score, answerSummary, phase);
        }
        catch (err) {
            // Keep the raw constraint/IO cause but make the failure attributable.
            throw new Error(`failed to record attempt ${attemptId} for question ${questionId} (version ${questionVersion}): ${errorMessage(err)}`, { cause: err });
        }
    }
    recentFor(questionId, limit = 10) {
        return this.ldb.db
            .prepare('SELECT * FROM attempts WHERE question_id = ? ORDER BY id DESC LIMIT ?')
            .all(questionId, limit);
    }
    count() {
        const row = this.ldb.db.prepare('SELECT COUNT(*) AS n FROM attempts').get();
        return row.n;
    }
}
