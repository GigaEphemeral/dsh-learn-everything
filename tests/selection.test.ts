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

test("coverage is clamped to 0..1 and non-finite inputs do not poison the score (A38)", () => {
  const ldb = new LearningDb(':memory:');
  const sel = new PracticeSelector(ldb, { overdue: 0, weakness: 0, coverage: 1, novelty: 0 });
  // topicCount 2 with 5 attempts would be 2.5 without clamping.
  assert.equal(sel.score("q", { attemptedCount: 5, topicCount: 2 }), 1);
  // Negative coverage would invert the ranking without clamping.
  assert.equal(sel.score("q", { attemptedCount: -3, topicCount: 2 }), 0);
  assert.equal(sel.score("q", { attemptedCount: Number.NaN, topicCount: 2 }), 0);
  assert.equal(sel.score("q", { attemptedCount: 1, topicCount: 2 }), 0.5);
  ldb.close();
});

test("invalid next_review timestamps neither crash nor produce NaN scores (A39)", () => {
  const ldb = new LearningDb(':memory:');
  const review = new ReviewStore(ldb);
  review.applyAttempt("q_bad", false);
  ldb.db.prepare("UPDATE review_schedule SET next_review = 'not-a-date' WHERE question_id = 'q_bad'").run();
  const sel = new PracticeSelector(ldb, { overdue: 1, weakness: 0, coverage: 0, novelty: 0 });
  const score = sel.score("q_bad", { now: new Date("2026-01-01T00:00:00Z") });
  assert.ok(Number.isFinite(score));
  assert.equal(score, 0); // corrupt timestamp is not "overdue"
  // A valid overdue timestamp still earns the full overdue weight.
  ldb.db.prepare("UPDATE review_schedule SET next_review = '2020-01-01T00:00:00.000Z' WHERE question_id = 'q_bad'").run();
  assert.equal(sel.score("q_bad", { now: new Date("2020-01-02T00:00:00Z") }), 1);
  ldb.close();
});

test("partial weight overrides merge over defaults (A40)", () => {
  const ldb = new LearningDb(':memory:');
  const sel = new PracticeSelector(ldb, { coverage: 1 });
  // Default novelty 0.3 + overridden coverage 1 * 0.5 = 0.8; the other default
  // weights (overdue/weakness) stay 1.0/0.8 for the untouched dimensions.
  const score = sel.score("q_fresh", { attemptedCount: 1, topicCount: 2 });
  assert.ok(Math.abs(score - 0.8) < 1e-9, `expected 0.8, got ${score}`);
  ldb.close();
});

test("weights resolve per instance from env and must be non-negative finite (A40/A41)", () => {
  const ldb = new LearningDb(':memory:');
  const previous = process.env.OBSIDIAN_REVIEW_W_NOVELTY;
  try {
    process.env.OBSIDIAN_REVIEW_W_NOVELTY = "1";
    // Read at construction time, not at module load (module loaded earlier).
    assert.equal(new PracticeSelector(ldb).score("q_fresh"), 1);
    process.env.OBSIDIAN_REVIEW_W_NOVELTY = "-2";
    assert.throws(() => new PracticeSelector(ldb), /non-negative/);
  } finally {
    if (previous === undefined) delete process.env.OBSIDIAN_REVIEW_W_NOVELTY;
    else process.env.OBSIDIAN_REVIEW_W_NOVELTY = previous;
  }
  assert.throws(() => new PracticeSelector(ldb, { overdue: -1 }), /non-negative/);
  assert.throws(() => new PracticeSelector(ldb, { overdue: Number.NaN }), /finite number/);
  ldb.close();
});
