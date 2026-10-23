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
    startQuestion(q) {
        try {
            this.questions.create(q);
        }
        catch {
            // question_id already exists (re-generated); keep the first record.
        }
    }
    // Persist one answer + its LLM rating + review + mastery evidence.
    recordAnswer(a) {
        const attemptId = newAttemptId();
        this.attempts.record({
            attemptId,
            questionId: a.questionId,
            questionVersion: a.questionVersion,
            result: a.result,
            score: a.score,
            answerSummary: a.answerSummary,
            phase: a.phase,
        });
        if (a.modelRating !== null || a.feedback || a.errorAnalysis || a.suggestions) {
            this.ldb.db
                .prepare('INSERT INTO ratings (attempt_id, model_rating, feedback, error_analysis, suggestions, rated_at) VALUES (?, ?, ?, ?, ?, ?)')
                .run(attemptId, a.modelRating, a.feedback, a.errorAnalysis, a.suggestions, new Date().toISOString());
        }
        this.review.applyAttempt(a.questionId, a.correct);
        for (const c of a.concepts) {
            const id = this.mastery.ensureConcept(c.name, c.wikiPath);
            this.mastery.recordLevel(id, c.level, c.source);
        }
        return attemptId;
    }
}
