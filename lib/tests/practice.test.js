// Unit tests for the practice session orchestrator (S2, task 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LearningDb } from '../src/db/client.js';
import { PracticeSession } from '../src/learning/practice.js';
import { QuestionStore } from '../src/learning/questions.js';
import { ReviewStore } from '../src/learning/review.js';
import { MasteryStore } from '../src/learning/mastery.js';
test("startQuestion + recordAnswer persist question, attempt, rating, review, mastery", () => {
    const ldb = new LearningDb(':memory:');
    const ps = new PracticeSession(ldb);
    ps.startQuestion({ questionId: "q1", version: 1, type: "concept", topic: "间隔重复", prompt: "解释", reference: "ref" });
    const attemptId = ps.recordAnswer({
        questionId: "q1",
        questionVersion: 1,
        phase: "first",
        correct: false,
        result: "incorrect",
        score: 2,
        answerSummary: "记不清",
        modelRating: 2,
        feedback: "没说到遗忘临界点",
        errorAnalysis: "概念混淆",
        suggestions: "重读遗忘曲线",
        concepts: [{ name: "间隔重复", wikiPath: "wiki/concepts/间隔重复.md", level: 0.3, source: "first_answer" }],
    });
    assert.ok(attemptId.startsWith("attempt_"));
    const q = new QuestionStore(ldb).get("q1");
    assert.equal(q?.topic, "间隔重复");
    const att = ldb.db.prepare("SELECT * FROM attempts WHERE attempt_id = ?").get(attemptId);
    assert.equal(att.result, "incorrect");
    assert.equal(att.phase, "first");
    const rat = ldb.db.prepare("SELECT * FROM ratings WHERE attempt_id = ?").get(attemptId);
    assert.equal(rat.model_rating, 2);
    const rev = new ReviewStore(ldb).get("q1");
    assert.equal(rev.last_result, "incorrect");
    const m = new MasteryStore(ldb);
    const conceptId = m.ensureConcept("间隔重复", null);
    assert.equal(m.recentLevels(conceptId).length, 1);
    ldb.close();
});
test("a later variant pass updates mastery and review independently", () => {
    const ldb = new LearningDb(':memory:');
    const ps = new PracticeSession(ldb);
    ps.startQuestion({ questionId: "q1", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
    ps.recordAnswer({ questionId: "q1", questionVersion: 1, phase: "first", correct: false, result: "incorrect", score: 2, answerSummary: null, modelRating: 2, feedback: "f", errorAnalysis: "e", suggestions: "s", concepts: [] });
    ps.recordAnswer({ questionId: "q1", questionVersion: 1, phase: "variant", correct: true, result: "correct", score: 4, answerSummary: "能讲清了", modelRating: 4, feedback: "进步", errorAnalysis: null, suggestions: null, concepts: [{ name: "t", wikiPath: null, level: 0.7, source: "variant_pass" }] });
    const rev = new ReviewStore(ldb).get("q1");
    assert.equal(rev.last_result, "correct");
    assert.equal(rev.correct_streak, 1);
    const m = new MasteryStore(ldb);
    const id = m.ensureConcept("t", null);
    const levels = m.recentLevels(id);
    assert.equal(levels.length, 1);
    assert.equal(levels[0].source, "variant_pass");
    ldb.close();
});
