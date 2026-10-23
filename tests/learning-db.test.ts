// Unit tests for the SQLite learning-state layer (S2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LearningDb } from '../src/db/client.js';
import { SCHEMA_VERSION } from '../src/db/schema.js';
import { AttemptStore } from '../src/learning/attempts.js';
import { QuestionStore } from '../src/learning/questions.js';
import { ReviewStore } from '../src/learning/review.js';

test('schema migration applies once and reports the version', () => {
  const ldb = new LearningDb(':memory:');
  assert.equal(ldb.schemaVersion(), SCHEMA_VERSION);
  // schema_version has exactly SCHEMA_VERSION rows
  const row = ldb.db.prepare('SELECT COUNT(*) AS n FROM schema_version').get() as { n: number };
  assert.equal(row.n, SCHEMA_VERSION);
  ldb.close();
});

test('attempts are append-only and keep the question version', () => {
  const ldb = new LearningDb(':memory:');
  const questions = new QuestionStore(ldb);
  questions.create({ questionId: 'q1', version: 1, type: 'concept', topic: '间隔重复', prompt: '解释', reference: 'ref' });
  const attempts = new AttemptStore(ldb);
  attempts.record({ attemptId: 'a1', questionId: 'q1', questionVersion: 1, result: 'incorrect', score: 0.4, answerSummary: 'partial', phase: 'first' });
  attempts.record({ attemptId: 'a2', questionId: 'q1', questionVersion: 1, result: 'correct', score: 1, answerSummary: 'good', phase: 'variant' });
  assert.equal(attempts.count(), 2);
  const recent = attempts.recentFor('q1');
  assert.equal(recent.length, 2);
  assert.equal(recent[0].result, 'correct');
  assert.equal(recent[0].phase, 'variant');
  ldb.close();
});

test('review schedule doubles the interval on success and resets on failure', () => {
  const ldb = new LearningDb(':memory:');
  const questions = new QuestionStore(ldb);
  questions.create({ questionId: 'q1', version: 1, type: 'concept', topic: 't', prompt: 'p', reference: null });
  const review = new ReviewStore(ldb);
  review.applyAttempt('q1', true);
  assert.equal((review.get('q1') as { interval_days: number }).interval_days, 1);
  review.applyAttempt('q1', true);
  assert.equal((review.get('q1') as { interval_days: number }).interval_days, 2);
  review.applyAttempt('q1', false);
  assert.equal((review.get('q1') as { interval_days: number }).interval_days, 1);
  assert.equal((review.get('q1') as { correct_streak: number }).correct_streak, 0);
  ldb.close();
});

test('due questions are returned by next_review', () => {
  const ldb = new LearningDb(':memory:');
  const questions = new QuestionStore(ldb);
  questions.create({ questionId: 'due', version: 1, type: 'concept', topic: 't', prompt: 'p', reference: null });
  const review = new ReviewStore(ldb);
  review.applyAttempt('due', false); // next_review = 1 day out -> not due now
  assert.deepEqual(review.dueQuestionIds(new Date('2020-01-01T00:00:00Z')), []);
  // force an overdue entry directly
  ldb.db.prepare('UPDATE review_schedule SET next_review = ? WHERE question_id = ?').run('2020-01-01T00:00:00Z', 'due');
  assert.deepEqual(review.dueQuestionIds(new Date('2020-01-02T00:00:00Z')), ['due']);
  ldb.close();
});

