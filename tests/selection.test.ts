// Unit tests for practice selection (S2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LearningDb } from '../src/db/client.js';
import { QuestionStore } from '../src/learning/questions.js';
import { ReviewStore } from '../src/learning/review.js';
import { PracticeSelector } from '../src/learning/selection.js';
import { PracticeSession } from '../src/learning/practice.js';

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


test("weakness reflects recent incorrect history, not only last result", () => {
  const ldb = new LearningDb(':memory:');
  const questions = new QuestionStore(ldb);
  questions.create({ questionId: "q_weak2", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
  questions.create({ questionId: "q_ok2", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
  const ps = new PracticeSession(ldb);
  ps.recordAnswer({ questionId: "q_weak2", questionVersion: 1, phase: "first", correct: false, result: "incorrect", score: 1, answerSummary: null, modelRating: null, feedback: null, errorAnalysis: null, suggestions: null, concepts: [] });
  ps.recordAnswer({ questionId: "q_weak2", questionVersion: 1, phase: "correction", correct: false, result: "incorrect", score: 2, answerSummary: null, modelRating: null, feedback: null, errorAnalysis: null, suggestions: null, concepts: [] });
  ps.recordAnswer({ questionId: "q_ok2", questionVersion: 1, phase: "first", correct: true, result: "correct", score: 4, answerSummary: null, modelRating: null, feedback: null, errorAnalysis: null, suggestions: null, concepts: [] });
  const sel = new PracticeSelector(ldb);
  assert.ok(sel.score("q_weak2") > sel.score("q_ok2"));
  ldb.close();
});

test("selectCandidates ranks by score and respects the limit", () => {
  const ldb = new LearningDb(':memory:');
  const ps = new PracticeSession(ldb);
  ps.startQuestion({ questionId: "a", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
  ps.startQuestion({ questionId: "b", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
  ps.recordAnswer({ questionId: "a", questionVersion: 1, phase: "first", correct: false, result: "incorrect", score: 1, answerSummary: null, modelRating: null, feedback: null, errorAnalysis: null, suggestions: null, concepts: [] });
  const sel = new PracticeSelector(ldb);
  const picked = sel.selectCandidates([{ questionId: "a", topicCount: 2, attemptedCount: 1 }, { questionId: "b", topicCount: 2, attemptedCount: 0 }], 1);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].questionId, "a"); // weak+attempted beats fresh
  ldb.close();
});

test("selection sees history across question versions (A6/A8 integration)", () => {
  const ldb = new LearningDb(':memory:');
  const ps = new PracticeSession(ldb);
  ps.startQuestion({ questionId: "q1", version: 1, type: "concept", topic: "t", prompt: "v1", reference: null });
  ps.startQuestion({ questionId: "q1", version: 2, type: "concept", topic: "t", prompt: "v2", reference: null });
  // The latest stored version is what a reader gets back ...
  assert.equal(new QuestionStore(ldb).get("q1")?.version, 2);
  // ... while each attempt keeps the version it actually answered.
  ps.recordAnswer({ questionId: "q1", questionVersion: 1, phase: "first", correct: false, result: "incorrect", score: 1, answerSummary: null, concepts: [] });
  ps.recordAnswer({ questionId: "q1", questionVersion: 2, phase: "correction", correct: true, result: "correct", score: 4, answerSummary: null, concepts: [] });
  const attempts = ldb.db.prepare("SELECT question_version, result FROM attempts WHERE question_id = ? ORDER BY id").all("q1") as Array<{ question_version: number; result: string }>;
  assert.deepEqual(attempts.map((a) => [a.question_version, a.result]), [[1, "incorrect"], [2, "correct"]]);
  // Review state is per question id and reflects the latest answer.
  const rev = new ReviewStore(ldb).get("q1") as { last_result: string; correct_streak: number };
  assert.equal(rev.last_result, "correct");
  assert.equal(rev.correct_streak, 1);
  // Weakness history spans versions, so selection can still rank the question.
  const sel = new PracticeSelector(ldb);
  assert.ok(sel.score("q1") > 0);
  ldb.close();
});
