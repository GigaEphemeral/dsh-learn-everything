// Unit tests for practice selection (S2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LearningDb } from '../src/db/client.js';
import { QuestionStore } from '../src/learning/questions.js';
import { ReviewStore } from '../src/learning/review.js';
import { PracticeSelector } from '../src/learning/selection.js';
test("overdue questions score higher than fresh ones", () => {
    const ldb = new LearningDb(':memory:');
    const questions = new QuestionStore(ldb);
    questions.create({ questionId: "q_due", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
    questions.create({ questionId: "q_fresh", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
    const review = new ReviewStore(ldb);
    review.applyAttempt("q_due", false);
    ldb.db.prepare('UPDATE review_schedule SET next_review = ? WHERE question_id = ?').run('2020-01-01T00:00:00Z', 'q_due');
    const sel = new PracticeSelector(ldb);
    const now = new Date("2020-01-02T00:00:00Z");
    assert.ok(sel.score("q_due", { now }) > sel.score("q_fresh", { now }));
    ldb.close();
});
test("weak (last incorrect) scores above a plain correct entry", () => {
    const ldb = new LearningDb(':memory:');
    const questions = new QuestionStore(ldb);
    questions.create({ questionId: "q_weak", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
    questions.create({ questionId: "q_ok", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
    const review = new ReviewStore(ldb);
    review.applyAttempt("q_weak", false);
    review.applyAttempt("q_ok", true);
    const sel = new PracticeSelector(ldb);
    assert.ok(sel.score("q_weak") > sel.score("q_ok"));
    ldb.close();
});
