// Practice selection (S2, task 4 groundwork; ported from the archived
// review-scheduler.js scoring). Weighted priority for what to practice:
// overdue > weakness > coverage (avoid topic skew) > novelty. Weights are
// env-configurable (OBSIDIAN_REVIEW_W_*). Kept separate from storage so it
// stays explainable and testable.
function envNumber(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '')
        return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}
export const DEFAULT_SELECTION_WEIGHTS = {
    overdue: envNumber('OBSIDIAN_REVIEW_W_OVERDUE', 1.0),
    weakness: envNumber('OBSIDIAN_REVIEW_W_WEAKNESS', 0.8),
    coverage: envNumber('OBSIDIAN_REVIEW_W_COVERAGE', 0.5),
    novelty: envNumber('OBSIDIAN_REVIEW_W_NOVELTY', 0.3),
};
export class PracticeSelector {
    ldb;
    weights;
    constructor(ldb, weights = DEFAULT_SELECTION_WEIGHTS) {
        this.ldb = ldb;
        this.weights = weights;
    }
    score(questionId, opts = {}) {
        const { attemptedCount = 0, topicCount = 1, now = new Date() } = opts;
        const cur = this.ldb.db
            .prepare('SELECT next_review, last_result FROM review_schedule WHERE question_id = ?')
            .get(questionId);
        const overdue = cur && new Date(cur.next_review) <= now ? 1 : 0;
        const weakness = cur && cur.last_result === 'incorrect' ? 1 : 0;
        const coverage = topicCount > 1 ? attemptedCount / topicCount : 0;
        const novelty = cur ? 0 : 1;
        return (this.weights.overdue * overdue +
            this.weights.weakness * weakness +
            this.weights.coverage * coverage +
            this.weights.novelty * novelty);
    }
}
