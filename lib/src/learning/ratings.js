// LLM rating records (S2, A19). One rating row per rated answer; the practice
// orchestrator writes it inside the same transaction as the attempt, so a
// rating can never survive without its attempt (or the other way around).
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
export class RatingStore {
    ldb;
    constructor(ldb) {
        this.ldb = ldb;
    }
    // Write one rating row. Optional fields are normalised undefined -> null so
    // node:sqlite never receives an undefined binding (empty strings are kept:
    // they are provided values, not missing ones).
    record(r) {
        if (typeof r.attemptId !== 'string' || r.attemptId.trim() === '') {
            throw new Error('rating.record requires a non-empty attemptId');
        }
        const modelRating = r.modelRating === undefined ? null : r.modelRating;
        const feedback = r.feedback === undefined ? null : r.feedback;
        const errorAnalysis = r.errorAnalysis === undefined ? null : r.errorAnalysis;
        const suggestions = r.suggestions === undefined ? null : r.suggestions;
        try {
            this.ldb.db
                .prepare('INSERT INTO ratings (attempt_id, model_rating, feedback, error_analysis, suggestions, rated_at) VALUES (?, ?, ?, ?, ?, ?)')
                .run(r.attemptId, modelRating, feedback, errorAnalysis, suggestions, new Date().toISOString());
        }
        catch (err) {
            throw new Error(`failed to record rating for attempt ${r.attemptId}: ${errorMessage(err)}`, { cause: err });
        }
    }
    forAttempt(attemptId) {
        return this.ldb.db
            .prepare('SELECT attempt_id, model_rating, feedback, error_analysis, suggestions, rated_at FROM ratings WHERE attempt_id = ?')
            .get(attemptId);
    }
}
