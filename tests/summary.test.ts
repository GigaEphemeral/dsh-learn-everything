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
