// Unit tests for the learning snapshot export (S2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LearningDb } from '../src/db/client.js';
import { PracticeSession } from '../src/learning/practice.js';
import { buildSnapshot } from '../src/learning/export.js';

test("buildSnapshot reflects persisted learning state", () => {
  const ldb = new LearningDb(':memory:');
  const ps = new PracticeSession(ldb);
  ps.startQuestion({ questionId: "q1", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
  ps.recordAnswer({ questionId: "q1", questionVersion: 1, phase: "first", correct: false, result: "incorrect", score: 2, answerSummary: "a", modelRating: 2, feedback: "f", errorAnalysis: "e", suggestions: "s", concepts: [{ name: "t", wikiPath: null, level: 0.3, source: "first_answer" }] });
  const snap = buildSnapshot(ldb);
  assert.equal(snap.schemaVersion, 2);
  assert.equal(snap.counts.questions, 1);
  assert.equal(snap.counts.attempts, 1);
  assert.equal(snap.counts.ratings, 1);
  assert.equal(snap.counts.concepts, 1);
  assert.equal(snap.counts.masteryEvents, 1);
  assert.equal(snap.counts.reviewEntries, 1);
  assert.equal(snap.attempts[0].result, "incorrect");
  ldb.close();
});
