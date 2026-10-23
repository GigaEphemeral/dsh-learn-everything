// Unit tests for the practice session orchestrator (S2, task 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LearningDb } from '../src/db/client.js';
import { PracticeSession } from '../src/learning/practice.js';
import { QuestionStore } from '../src/learning/questions.js';
import { AttemptStore } from '../src/learning/attempts.js';
import { ReviewStore } from '../src/learning/review.js';
import { MasteryStore } from '../src/learning/mastery.js';
import { RatingStore } from '../src/learning/ratings.js';

function countAll(ldb: LearningDb, table: string): number {
  const row = ldb.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

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
  const att = ldb.db.prepare("SELECT * FROM attempts WHERE attempt_id = ?").get(attemptId) as Record<string, unknown>;
  assert.equal(att.result, "incorrect");
  assert.equal(att.phase, "first");
  const rat = ldb.db.prepare("SELECT * FROM ratings WHERE attempt_id = ?").get(attemptId) as Record<string, unknown>;
  assert.equal(rat.model_rating, 2);
  const rev = new ReviewStore(ldb).get("q1") as { last_result: string };
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
  const rev = new ReviewStore(ldb).get("q1") as { last_result: string; correct_streak: number };
  assert.equal(rev.last_result, "correct");
  assert.equal(rev.correct_streak, 1);
  const m = new MasteryStore(ldb);
  const id = m.ensureConcept("t", null);
  const levels = m.recentLevels(id);
  assert.equal(levels.length, 1);
  assert.equal(levels[0].source, "variant_pass");
  ldb.close();
});

test("startQuestion only suppresses duplicate-version conflicts and stores higher versions (A14)", () => {
  const ldb = new LearningDb(':memory:');
  const ps = new PracticeSession(ldb);
  ps.startQuestion({ questionId: "q1", version: 1, type: "concept", topic: "t", prompt: "v1", reference: null });
  // Same (question_id, version) regenerated: keep the first record, no throw.
  ps.startQuestion({ questionId: "q1", version: 1, type: "concept", topic: "t", prompt: "v1 regenerated", reference: null });
  assert.equal(countAll(ldb, "questions"), 1);
  assert.equal(new QuestionStore(ldb).get("q1")?.prompt, "v1");
  // A regenerated higher version is a new row and must be persisted.
  ps.startQuestion({ questionId: "q1", version: 2, type: "concept", topic: "t", prompt: "v2", reference: null });
  assert.equal(countAll(ldb, "questions"), 2);
  assert.equal(new QuestionStore(ldb).get("q1")?.prompt, "v2");
  // Anything that is not a UNIQUE conflict must reach the caller.
  assert.throws(
    () => ps.startQuestion({ questionId: "q2", version: 1, type: "concept", topic: "t", prompt: null as unknown as string, reference: null }),
    /non-empty prompt/,
  );
  ldb.close();
});

test("recordAnswer rolls back attempt, rating, review and mastery together (A15)", () => {
  const ldb = new LearningDb(':memory:');
  const ps = new PracticeSession(ldb);
  ps.startQuestion({ questionId: "q1", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
  assert.throws(
    () => ps.recordAnswer({
      questionId: "q1",
      questionVersion: 1,
      phase: "first",
      correct: false,
      result: "incorrect",
      score: 1,
      answerSummary: null,
      modelRating: 2,
      feedback: "f",
      errorAnalysis: null,
      suggestions: null,
      // Invalid mastery source is rejected after the attempt/rating/review writes.
      concepts: [{ name: "c1", wikiPath: null, level: 0.5, source: "llm_says_so" }],
    }),
    /unknown mastery source/,
  );
  assert.equal(countAll(ldb, "attempts"), 0);
  assert.equal(countAll(ldb, "ratings"), 0);
  assert.equal(countAll(ldb, "concepts"), 0);
  assert.equal(countAll(ldb, "mastery_history"), 0);
  assert.equal(new ReviewStore(ldb).get("q1"), undefined);
  // The database stays usable after the rollback.
  const attemptId = ps.recordAnswer({ questionId: "q1", questionVersion: 1, phase: "first", correct: true, result: "correct", score: 1, answerSummary: null, concepts: [] });
  assert.equal(countAll(ldb, "attempts"), 1);
  assert.equal(countAll(ldb, "ratings"), 0);
  assert.ok(attemptId.startsWith("attempt_"));
  ldb.close();
});

test("omitted optional answer fields are normalised to null (A16)", () => {
  const ldb = new LearningDb(':memory:');
  const ps = new PracticeSession(ldb);
  ps.startQuestion({ questionId: "q1", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
  // All optional fields omitted: no undefined binding may reach node:sqlite and
  // no rating row is written.
  const firstId = ps.recordAnswer({ questionId: "q1", questionVersion: 1, phase: "first", correct: true, result: "correct", score: null, answerSummary: null, concepts: [] });
  assert.equal(ldb.db.prepare("SELECT * FROM ratings WHERE attempt_id = ?").get(firstId), undefined);
  assert.equal(countAll(ldb, "attempts"), 1);

  // An empty-string feedback is a provided rating field (it must not be skipped
  // by a truthiness check) and omitted numbers become SQL NULL.
  const secondId = ps.recordAnswer({ questionId: "q1", questionVersion: 1, phase: "correction", correct: false, result: "incorrect", score: 2, answerSummary: "记不清", modelRating: undefined, feedback: "", errorAnalysis: undefined, suggestions: undefined, concepts: [] });
  const rating = ldb.db.prepare("SELECT * FROM ratings WHERE attempt_id = ?").get(secondId) as Record<string, unknown> | undefined;
  assert.ok(rating, "expected a rating row for empty-string feedback");
  assert.equal(rating.model_rating, null);
  assert.equal(rating.feedback, "");
  assert.equal(rating.error_analysis, null);
  assert.equal(rating.suggestions, null);
  ldb.close();
});

test("recordAnswer defaults concepts to empty and skips malformed entries (A17)", () => {
  const ldb = new LearningDb(':memory:');
  const ps = new PracticeSession(ldb);
  ps.startQuestion({ questionId: "q1", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
  // Concepts omitted entirely: the answer is still recorded (no TypeError).
  const withoutConcepts = ps.recordAnswer({ questionId: "q1", questionVersion: 1, result: "correct", score: 1, answerSummary: null });
  assert.ok(withoutConcepts.startsWith("attempt_"));
  assert.equal(countAll(ldb, "concepts"), 0);
  // Nameless / malformed entries are skipped; the valid one is recorded.
  const withMixed = ps.recordAnswer({
    questionId: "q1",
    questionVersion: 1,
    result: "correct",
    score: 1,
    answerSummary: null,
    concepts: [
      { name: "", wikiPath: null, level: 0.5, source: "first_answer" },
      { name: "   ", wikiPath: null, level: 0.5, source: "first_answer" },
      null as unknown as { name: string; wikiPath: string | null; level: number; source: string },
      { name: "valid", wikiPath: undefined as unknown as string | null, level: 0.5, source: "first_answer" },
    ],
  });
  assert.ok(withMixed.startsWith("attempt_"));
  assert.equal(countAll(ldb, "attempts"), 2);
  assert.equal(countAll(ldb, "concepts"), 1);
  assert.equal(countAll(ldb, "mastery_history"), 1);
  const concept = ldb.db.prepare("SELECT name, wiki_path FROM concepts").get() as { name: string; wiki_path: string | null };
  assert.equal(concept.name, "valid");
  assert.equal(concept.wiki_path, null); // undefined wikiPath normalised to null
  ldb.close();
});

test("recordAnswer derives correctness from result and rejects contradictions (A18)", () => {
  const ldb = new LearningDb(':memory:');
  const ps = new PracticeSession(ldb);
  ps.startQuestion({ questionId: "q1", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
  assert.throws(
    () => ps.recordAnswer({ questionId: "q1", questionVersion: 1, result: "incorrect", correct: true, score: 1, answerSummary: null }),
    /contradictory answer/,
  );
  // The mismatch is rejected before any write.
  assert.equal(countAll(ldb, "attempts"), 0);
  assert.equal(new ReviewStore(ldb).get("q1"), undefined);
  // Omitted `correct` is derived from `result`.
  ps.recordAnswer({ questionId: "q1", questionVersion: 1, result: "correct", score: 1, answerSummary: null });
  assert.equal((new ReviewStore(ldb).get("q1") as { last_result: string }).last_result, "correct");
  ps.recordAnswer({ questionId: "q1", questionVersion: 1, result: "incorrect", score: 1, answerSummary: null });
  assert.equal((new ReviewStore(ldb).get("q1") as { last_result: string }).last_result, "incorrect");
  // A partial answer is not a full success for scheduling.
  ps.recordAnswer({ questionId: "q1", questionVersion: 1, result: "partial", score: 1, answerSummary: null });
  assert.equal((new ReviewStore(ldb).get("q1") as { last_result: string }).last_result, "incorrect");
  ldb.close();
});

test("RatingStore records typed rating rows and surfaces its attempt context (A19)", () => {
  const ldb = new LearningDb(':memory:');
  const questions = new QuestionStore(ldb);
  questions.create({ questionId: "q1", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
  new AttemptStore(ldb).record({ attemptId: "a1", questionId: "q1", questionVersion: 1, result: "correct" });
  const ratings = new RatingStore(ldb);
  ratings.record({ attemptId: "a1", feedback: "" });
  const row = ratings.forAttempt("a1");
  assert.ok(row);
  assert.deepEqual(Object.keys(row).sort(), ["attempt_id", "error_analysis", "feedback", "model_rating", "rated_at", "suggestions"]);
  assert.equal(row.model_rating, null);
  assert.equal(row.feedback, ""); // empty string is a provided value, not NULL
  assert.equal(row.error_analysis, null);
  assert.throws(() => ratings.record({ attemptId: "  " }), /non-empty attemptId/);
  // The rating table still has its attempt FK; the error names the attempt.
  assert.throws(() => ratings.record({ attemptId: "missing" }), /failed to record rating for attempt missing/);
  ldb.close();
});

test("generated attempt ids are UUID-based and unique across rapid calls (A45)", () => {
  const ldb = new LearningDb(':memory:');
  const ps = new PracticeSession(ldb);
  ps.startQuestion({ questionId: "q1", version: 1, type: "concept", topic: "t", prompt: "p", reference: null });
  const uuidAttemptId = /^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const ids = new Set<string>();
  for (let i = 0; i < 25; i += 1) {
    const id = ps.recordAnswer({ questionId: "q1", questionVersion: 1, result: "correct", score: 1, answerSummary: null });
    assert.match(id, uuidAttemptId);
    ids.add(id);
  }
  assert.equal(ids.size, 25);
  assert.equal(countAll(ldb, "attempts"), 25);
  ldb.close();
});
