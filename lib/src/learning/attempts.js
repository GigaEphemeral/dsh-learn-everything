// Append-only attempt records (S2). Every answer is persisted; history is
// never rewritten. Links to the question version it was answered against.
export class AttemptStore {
    ldb;
    constructor(ldb) {
        this.ldb = ldb;
    }
    record(a) {
        this.ldb.db
            .prepare('INSERT INTO attempts (attempt_id, question_id, question_version, answered_at, result, score, answer_summary, phase) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(a.attemptId, a.questionId, a.questionVersion, new Date().toISOString(), a.result, a.score, a.answerSummary, a.phase);
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
