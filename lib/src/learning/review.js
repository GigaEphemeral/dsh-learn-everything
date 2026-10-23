// Review scheduling state (S2). Simple, explainable interval doubling;
// priorities are computed per question (overdue / weak / novel). FSRS is
// deferred until real data shows a benefit.
const DAY_MS = 24 * 60 * 60 * 1000;
export class ReviewStore {
    ldb;
    constructor(ldb) {
        this.ldb = ldb;
    }
    applyAttempt(questionId, correct) {
        const cur = this.ldb.db
            .prepare('SELECT interval_days, correct_streak FROM review_schedule WHERE question_id = ?')
            .get(questionId);
        const intervalDays = correct ? (cur ? Math.min(Math.max(1, cur.interval_days * 2), 30) : 1) : 1;
        const streak = correct ? (cur?.correct_streak ?? 0) + 1 : 0;
        const nextReview = new Date(Date.now() + intervalDays * DAY_MS).toISOString();
        const now = new Date().toISOString();
        this.ldb.db
            .prepare('INSERT INTO review_schedule (question_id, interval_days, correct_streak, last_result, next_review, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(question_id) DO UPDATE SET interval_days=excluded.interval_days, correct_streak=excluded.correct_streak, last_result=excluded.last_result, next_review=excluded.next_review, updated_at=excluded.updated_at')
            .run(questionId, intervalDays, streak, correct ? 'correct' : 'incorrect', nextReview, now);
        return { intervalDays, nextReview };
    }
    get(questionId) {
        return this.ldb.db
            .prepare('SELECT * FROM review_schedule WHERE question_id = ?')
            .get(questionId);
    }
    dueQuestionIds(now = new Date()) {
        const rows = this.ldb.db
            .prepare('SELECT question_id FROM review_schedule WHERE next_review <= ?')
            .all(now.toISOString());
        return rows.map((r) => r.question_id);
    }
}
