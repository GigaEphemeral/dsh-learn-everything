// Unit tests for the learning-state summary (S3, T2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LearningDb } from '../src/db/client.js';
import { PracticeSession } from '../src/learning/practice.js';
import { learningSummaryFor } from '../src/learning/summary.js';

test("learningSummaryFor aggregates attempts by result for a topic", () => {
  const ldb = new LearningDb(':memory:');
  const ps = new PracticeSession(ldb);
  ps.startQuestion({ questionId: "q1", version: 1, type: "concept", topic: "间隔重复", prompt: "p", reference: null });
  ps.recordAnswer({ questionId: "q1", questionVersion: 1, phase: "first", correct: false, result: "incorrect", score: 1, answerSummary: null, modelRating: null, feedback: null, errorAnalysis: null, suggestions: null, concepts: [{ name: "间隔重复", wikiPath: null, level: 0.3, source: "first_answer" }] });
  ps.recordAnswer({ questionId: "q1", questionVersion: 1, phase: "variant", correct: true, result: "correct", score: 4, answerSummary: null, modelRating: null, feedback: null, errorAnalysis: null, suggestions: null, concepts: [] });
  const s = learningSummaryFor(ldb, "间隔重复");
  assert.equal(s.questions.length, 1);
  assert.equal(s.attempts.total, 2);
  assert.equal(s.attempts.byResult.incorrect, 1);
  assert.equal(s.attempts.byResult.correct, 1);
  assert.ok(s.review);
  assert.equal(s.mastery.length, 1);
  ldb.close();
});

test("learningSummaryFor is empty for a never-practiced topic", () => {
  const ldb = new LearningDb(':memory:');
  const s = learningSummaryFor(ldb, "不存在");
  assert.equal(s.questions.length, 0);
  assert.equal(s.attempts.total, 0);
  assert.equal(s.review, null);
  assert.deepEqual(s.mastery, []);
  ldb.close();
});

test("learningSummaryFor reports the topic's earliest schedule, not the oldest question id", () => {
  const ldb = new LearningDb(':memory:');
  const ps = new PracticeSession(ldb);
  // q1 is the oldest question and gets a schedule.
  ps.startQuestion({ questionId: "q1", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
  ps.recordAnswer({ questionId: "q1", questionVersion: 1, correct: true, result: "correct", score: 1, answerSummary: null, modelRating: null, feedback: null, errorAnalysis: null, suggestions: null, concepts: [] });
  // q2 is newer but never answered, so it has no review_schedule row.
  ps.startQuestion({ questionId: "q2", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
  const s = learningSummaryFor(ldb, "t");
  assert.ok(s.review, "an answered question of the topic must be summarized");
  assert.equal(s.review.question_id, "q1");
  assert.equal(typeof s.review.interval_days, "number");
  ldb.close();
});

test("learningSummaryFor bounds the question list and deduplicates ids for attempt counts", () => {
  const ldb = new LearningDb(':memory:');
  const ps = new PracticeSession(ldb);
  // 25 questions plus a second version of q0: the summary stays bounded.
  for (let i = 0; i < 25; i += 1) {
    ps.startQuestion({ questionId: `q${i}`, version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
  }
  ps.startQuestion({ questionId: "q0", version: 2, type: "concept", topic: "t", prompt: "p2", reference: null });
  ps.recordAnswer({ questionId: "q0", questionVersion: 1, correct: false, result: "incorrect", score: 1, answerSummary: null, modelRating: null, feedback: null, errorAnalysis: null, suggestions: null, concepts: [] });
  const s = learningSummaryFor(ldb, "t");
  assert.ok(s.questions.length <= 20, `expected a bounded summary, got ${s.questions.length}`);
  // The attempt still counts once even though q0 has two versions.
  assert.equal(s.attempts.total, 1);
  ldb.close();
});
