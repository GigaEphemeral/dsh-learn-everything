// Practice session orchestrator (S2, task 3). Records a generated question,
// then every answer with its LLM rating, error analysis, and review-schedule
// update. Phases: first / correction / variant. All state goes to SQLite
// (decision B); nothing is written to Obsidian.
import { QuestionStore } from './questions.js';
import { AttemptStore } from './attempts.js';
import { ReviewStore } from './review.js';
import { MasteryStore } from './mastery.js';
function newAttemptId() {
    return `attempt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
// SQLITE_CONSTRAINT_UNIQUE; a duplicate (question_id, version) is the only
// error startQuestion may swallow. Everything else (missing table, disk full,
// binding error, NOT NULL ...) must reach the caller.
function isUniqueConstraintError(err) {
    if (!(err instanceof Error))
        return false;
    const errcode = err.errcode;
    return errcode === 2067 || /UNIQUE constraint failed/i.test(err.message);
}
export class PracticeSession {
    ldb;
    questions;
    attempts;
    review;
    mastery;
    constructor(ldb) {
        this.ldb = ldb;
        this.questions = new QuestionStore(ldb);
        this.attempts = new AttemptStore(ldb);
        this.review = new ReviewStore(ldb);
        this.mastery = new MasteryStore(ldb);
    }
    // Persist a freshly generated question (on-demand; version for traceability).
    // Re-generating the same (question_id, version) keeps the stored record; a
    // regenerated higher version is a new row (schema v2 composite uniqueness).
    startQuestion(q) {
        try {
            this.questions.create(q);
        }
        catch (err) {
            if (isUniqueConstraintError(err))
                return;
            throw err;
        }
    }
    // Persist one answer + its LLM rating + review + mastery evidence atomically:
    // if any store fails, the whole answer is rolled back instead of leaving an
    // attempt without rating/review/mastery (or the other way around).
    recordAnswer(a) {
        const attemptId = newAttemptId();
        // Normalise omitted optional fields to null so node:sqlite never receives
        // an undefined binding and "field empty" is distinguishable from "missing".
        const modelRating = a.modelRating === undefined ? null : a.modelRating;
        const feedback = a.feedback === undefined ? null : a.feedback;
        const errorAnalysis = a.errorAnalysis === undefined ? null : a.errorAnalysis;
        const suggestions = a.suggestions === undefined ? null : a.suggestions;
        this.ldb.transaction(() => {
            this.attempts.record({
                attemptId,
                questionId: a.questionId,
                questionVersion: a.questionVersion,
                result: a.result,
                score: a.score,
                answerSummary: a.answerSummary,
                phase: a.phase,
            });
            // `!== null` rather than truthiness: an empty-string feedback still means
            // a rating row was provided by the model.
            if (modelRating !== null || feedback !== null || errorAnalysis !== null || suggestions !== null) {
                this.ldb.db
                    .prepare('INSERT INTO ratings (attempt_id, model_rating, feedback, error_analysis, suggestions, rated_at) VALUES (?, ?, ?, ?, ?, ?)')
                    .run(attemptId, modelRating, feedback, errorAnalysis, suggestions, new Date().toISOString());
            }
            this.review.applyAttempt(a.questionId, a.correct);
            for (const c of a.concepts) {
                const id = this.mastery.ensureConcept(c.name, c.wikiPath);
                this.mastery.recordLevel(id, c.level, c.source);
            }
        });
        return attemptId;
    }
}
