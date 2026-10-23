// Unit tests for the SQLite learning-state layer (S2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LearningDb, applyConnectionInvariants } from '../src/db/client.js';
import { MIGRATIONS, SCHEMA_VERSION, migrate } from '../src/db/schema.js';
import { AttemptStore } from '../src/learning/attempts.js';
import type { AttemptRow, NewAttempt } from '../src/learning/attempts.js';
import type { AttemptResult, PracticePhase } from '../src/learning/types.js';
import { QuestionStore } from '../src/learning/questions.js';
import {
  DEFAULT_DUE_LIMIT,
  INTERVAL_GROWTH_FACTOR,
  MAX_INTERVAL_DAYS,
  MIN_INTERVAL_DAYS,
  ReviewStore,
  toCanonicalIso,
} from '../src/learning/review.js';
import type { ReviewSchedule } from '../src/learning/review.js';
import { MASTERY_SOURCES, MasteryStore } from '../src/learning/mastery.js';
import type { MasteryEvidence } from '../src/learning/mastery.js';

const NOW = '2026-01-01T00:00:00.000Z';

function indexNames(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
}

function countRows(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { n: number };
  return row.n;
}

// Seed a database exactly as the released v1 schema left it: schema_version=1
// plus real question/attempt/rating/mastery/review rows.
function seedV1Database(filePath: string): void {
  const db = new DatabaseSync(filePath);
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(MIGRATIONS[0]);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (1, ?)').run(NOW);
    db.prepare('INSERT INTO concepts (name, wiki_path, created_at) VALUES (?, ?, ?)').run('间隔重复', 'wiki/concepts/间隔重复.md', NOW);
    db.prepare('INSERT INTO questions (question_id, version, type, topic, prompt, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('q1', 1, 'concept', '间隔重复', '解释间隔重复', 'ref', NOW);
    db.prepare('INSERT INTO attempts (attempt_id, question_id, question_version, answered_at, result, score, answer_summary, phase) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('a1', 'q1', 1, NOW, 'incorrect', 0.4, 'partial', 'first');
    db.prepare('INSERT INTO ratings (attempt_id, model_rating, feedback, error_analysis, suggestions, rated_at) VALUES (?, ?, ?, ?, ?, ?)').run('a1', 2, 'f', 'e', 's', NOW);
    db.prepare('INSERT INTO mastery_history (concept_id, level, source, recorded_at) VALUES (?, ?, ?, ?)').run(1, 0.3, 'first_answer', NOW);
    db.prepare('INSERT INTO review_schedule (question_id, interval_days, correct_streak, last_result, next_review, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('q1', 1, 0, 'incorrect', '2026-01-02T00:00:00.000Z', NOW);
  } finally {
    db.close();
  }
}

test('schema migration applies once and reports the version', () => {
  const ldb = new LearningDb(':memory:');
  assert.equal(ldb.schemaVersion(), SCHEMA_VERSION);
  // schema_version has exactly SCHEMA_VERSION rows
  assert.equal(countRows(ldb.db, 'SELECT COUNT(*) AS n FROM schema_version'), SCHEMA_VERSION);
  ldb.close();
});

test('schemaVersion reports the stored MAX(version), not the compile-time constant (A3)', () => {
  const ldb = new LearningDb(':memory:');
  assert.equal(ldb.schemaVersion(), SCHEMA_VERSION);
  // Simulate a database written by a newer build: the stored version must win.
  ldb.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(999, NOW);
  assert.equal(ldb.schemaVersion(), 999);
  assert.notEqual(ldb.schemaVersion(), SCHEMA_VERSION);
  ldb.close();
});

test('v2 adds the history indexes and domain CHECK constraints (A34/A35)', () => {
  const ldb = new LearningDb(':memory:');
  assert.deepEqual(indexNames(ldb.db), [
    'idx_attempts_question',
    'idx_mastery_history_concept',
    'idx_ratings_attempt',
    'idx_review_schedule_next',
  ]);
  const questions = new QuestionStore(ldb);
  questions.create({ questionId: 'q1', version: 1, type: 'concept', topic: 't', prompt: 'p', reference: null });
  // attempts.result / attempts.phase
  assert.throws(
    () => ldb.db.prepare("INSERT INTO attempts (attempt_id, question_id, question_version, answered_at, result) VALUES ('x1', 'q1', 1, ?, 'bogus')").run(NOW),
    /CHECK constraint failed: result/,
  );
  assert.throws(
    () => ldb.db.prepare("INSERT INTO attempts (attempt_id, question_id, question_version, answered_at, result, phase) VALUES ('x2', 'q1', 1, ?, 'correct', 'nope')").run(NOW),
    /CHECK constraint failed: phase/,
  );
  // mastery_history.level 0..1 and source whitelist
  ldb.db.prepare('INSERT INTO concepts (name, wiki_path, created_at) VALUES (?, ?, ?)').run('c1', null, NOW);
  assert.throws(
    () => ldb.db.prepare('INSERT INTO mastery_history (concept_id, level, source, recorded_at) VALUES (1, 1.5, ?, ?)').run('first_answer', NOW),
    /CHECK constraint failed: level/,
  );
  assert.throws(
    () => ldb.db.prepare('INSERT INTO mastery_history (concept_id, level, source, recorded_at) VALUES (1, 0.5, ?, ?)').run('llm_said_so', NOW),
    /CHECK constraint failed: source/,
  );
  // review_schedule.interval_days >= 1 and correct_streak >= 0
  assert.throws(
    () => ldb.db.prepare('INSERT INTO review_schedule (question_id, interval_days, correct_streak, next_review, updated_at) VALUES (?, 0, 0, ?, ?)').run('q1', NOW, NOW),
    /CHECK constraint failed: interval_days/,
  );
  assert.throws(
    () => ldb.db.prepare('INSERT INTO review_schedule (question_id, interval_days, correct_streak, next_review, updated_at) VALUES (?, 1, -1, ?, ?)').run('q1', NOW, NOW),
    /CHECK constraint failed: correct_streak/,
  );
  ldb.close();
});

test('questions may have multiple versions; get() returns latest or the exact version (A6/A8)', () => {
  const ldb = new LearningDb(':memory:');
  const questions = new QuestionStore(ldb);
  questions.create({ questionId: 'q1', version: 1, type: 'concept', topic: 't', prompt: 'v1 prompt', reference: null });
  questions.create({ questionId: 'q1', version: 2, type: 'concept', topic: 't', prompt: 'v2 prompt', reference: null });
  assert.equal(questions.get('q1')?.prompt, 'v2 prompt');
  assert.equal(questions.get('q1', 1)?.prompt, 'v1 prompt');
  assert.equal(questions.get('q1', 2)?.prompt, 'v2 prompt');
  assert.equal(questions.get('q1', 99), undefined);
  // Uniqueness is per (question_id, version), not per question_id.
  assert.throws(
    () => questions.create({ questionId: 'q1', version: 1, type: 'concept', topic: 't', prompt: 'dup', reference: null }),
    /UNIQUE constraint failed: questions\.question_id, questions\.version/,
  );
  // Attempts link to the exact version and the FK rejects unknown versions.
  const attempts = new AttemptStore(ldb);
  attempts.record({ attemptId: 'a1', questionId: 'q1', questionVersion: 2, result: 'correct', score: 1, answerSummary: null, phase: 'variant' });
  assert.equal(attempts.recentFor('q1')[0].question_version, 2);
  assert.throws(
    () => attempts.record({ attemptId: 'a2', questionId: 'q1', questionVersion: 9, result: 'correct' }),
    /FOREIGN KEY constraint failed/,
  );
  ldb.close();
});

test('migrates an existing v1 database to v2 without losing learning history (A6/A31)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-learning-db-'));
  const file = join(dir, 'learning.db');
  try {
    seedV1Database(file);
    const ldb = new LearningDb(file);
    assert.equal(ldb.schemaVersion(), 2);
    assert.equal(countRows(ldb.db, 'SELECT COUNT(*) AS n FROM schema_version'), 2);
    // History survives the table rebuilds.
    const questions = new QuestionStore(ldb);
    assert.equal(questions.get('q1')?.prompt, '解释间隔重复');
    assert.equal(questions.get('q1', 1)?.version, 1);
    const attempts = new AttemptStore(ldb);
    assert.equal(attempts.count(), 1);
    assert.equal(attempts.recentFor('q1')[0].attempt_id, 'a1');
    assert.equal((ldb.db.prepare("SELECT model_rating FROM ratings WHERE attempt_id = 'a1'").get() as { model_rating: number }).model_rating, 2);
    assert.equal(countRows(ldb.db, 'SELECT COUNT(*) AS n FROM mastery_history'), 1);
    assert.equal((ldb.db.prepare("SELECT interval_days FROM review_schedule WHERE question_id = 'q1'").get() as { interval_days: number }).interval_days, 1);
    // The v1 -> v2 upgrade unlocks the new version model.
    questions.create({ questionId: 'q1', version: 2, type: 'concept', topic: '间隔重复', prompt: '解释间隔重复（第二版）', reference: null });
    assert.equal(questions.get('q1')?.version, 2);
    attempts.record({ attemptId: 'a2', questionId: 'q1', questionVersion: 2, result: 'correct', score: 1, answerSummary: null, phase: 'variant' });
    assert.equal(attempts.count(), 2);
    assert.throws(
      () => attempts.record({ attemptId: 'a3', questionId: 'q1', questionVersion: 9, result: 'correct' }),
      /FOREIGN KEY constraint failed/,
    );
    assert.deepEqual(ldb.db.prepare('PRAGMA foreign_key_check').all(), []);
    ldb.close();
    // Re-opening an already migrated database must not re-run the migration.
    const reopened = new LearningDb(file);
    assert.equal(reopened.schemaVersion(), 2);
    assert.equal(countRows(reopened.db, 'SELECT COUNT(*) AS n FROM schema_version'), 2);
    assert.equal(new AttemptStore(reopened).count(), 2);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration applies DDL and the version row in one transaction (A31)', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(MIGRATIONS[0]);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (1, ?)').run(NOW);
    db.prepare('INSERT INTO questions (question_id, version, type, topic, prompt, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('q1', 1, 'concept', 't', 'p', null, NOW);

    type PrepareFn = DatabaseSync['prepare'];
    const realPrepare = db.prepare.bind(db) as PrepareFn;
    let injected = false;
    const injectPrepare = ((sql: string) => {
      const stmt = realPrepare(sql);
      if (injected || !/^INSERT INTO schema_version/i.test(sql)) return stmt;
      injected = true;
      // Fail the version-row insert after the v2 DDL has run: without an
      // explicit transaction the half-migrated DDL would remain committed.
      return new Proxy(stmt, {
        get(target, prop, receiver) {
          if (prop === 'run') {
            return () => { throw new Error('injected version-row failure'); };
          }
          const value = Reflect.get(target, prop, receiver) as unknown;
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
    }) as PrepareFn;
    (db as unknown as { prepare: PrepareFn }).prepare = injectPrepare;

    assert.throws(() => migrate(db), /injected version-row failure/);
    // DDL was rolled back: still exactly the v1 schema version...
    assert.deepEqual(db.prepare('SELECT version FROM schema_version ORDER BY version').all().map((r) => (r as { version: number }).version), [1]);
    // ...and the v1 single-question-version rule still applies (proves the
    // questions table rebuild did not leak into the database).
    assert.throws(
      () => db.prepare('INSERT INTO questions (question_id, version, type, topic, prompt, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('q1', 2, 'concept', 't', 'p2', null, NOW),
      /UNIQUE constraint failed/,
    );
    assert.equal(countRows(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%\\_v2' ESCAPE '\\'"), 0);
    assert.equal((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1);

    // A retry after the transient failure upgrades cleanly.
    (db as unknown as { prepare: PrepareFn }).prepare = realPrepare;
    migrate(db);
    assert.deepEqual(db.prepare('SELECT version FROM schema_version ORDER BY version').all().map((r) => (r as { version: number }).version), [1, 2]);
    db.prepare('INSERT INTO questions (question_id, version, type, topic, prompt, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('q1', 2, 'concept', 't', 'p2', null, NOW);
    assert.equal(countRows(db, "SELECT COUNT(*) AS n FROM questions WHERE question_id = 'q1'"), 2);
  } finally {
    db.close();
  }
});

test('migration probe only tolerates a missing schema_version table (A32)', () => {
  const db = new DatabaseSync(':memory:');
  try {
    // The table exists but has the wrong shape: this is NOT a first run and the
    // original error must reach the caller instead of being swallowed.
    db.exec('CREATE TABLE schema_version (other TEXT)');
    assert.throws(() => migrate(db), /no such column: version/);
    // Nothing was half-created on top of the unexpected schema.
    assert.equal(countRows(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'questions'"), 0);
  } finally {
    db.close();
  }
});

test('attempt record validates required fields, defaults phase and normalises optionals (A9)', () => {
  const ldb = new LearningDb(':memory:');
  const questions = new QuestionStore(ldb);
  questions.create({ questionId: 'q1', version: 1, type: 'concept', topic: 't', prompt: 'p', reference: null });
  const attempts = new AttemptStore(ldb);
  const valid: NewAttempt = { attemptId: 'a1', questionId: 'q1', questionVersion: 1, result: 'correct' };

  assert.throws(() => attempts.record({ ...valid, attemptId: '' }), /non-empty attemptId/);
  assert.throws(() => attempts.record({ ...valid, questionId: undefined as unknown as string }), /non-empty questionId/);
  assert.throws(() => attempts.record({ ...valid, questionVersion: undefined as unknown as number }), /finite questionVersion/);
  assert.throws(() => attempts.record({ ...valid, result: undefined as unknown as AttemptResult }), /non-empty result/);

  // Optional fields omitted: phase defaults to "first", score/summary to null.
  attempts.record(valid);
  const row = ldb.db.prepare("SELECT phase, score, answer_summary FROM attempts WHERE attempt_id = 'a1'").get() as { phase: string; score: number | null; answer_summary: string | null };
  assert.equal(row.phase, 'first');
  assert.equal(row.score, null);
  assert.equal(row.answer_summary, null);

  // Duplicate attempt ids keep their constraint cause but gain attempt/question context.
  assert.throws(
    () => attempts.record({ ...valid, result: 'incorrect' }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /a1/);
      assert.match(err.message, /q1/);
      assert.match(err.message, /UNIQUE constraint failed: attempts\.attempt_id/);
      return true;
    },
  );
  assert.equal(attempts.count(), 1);
  ldb.close();
});

test('ensureConcept is idempotent and trims names without case folding (A20/A21)', () => {
  const ldb = new LearningDb(':memory:');
  const mastery = new MasteryStore(ldb);
  const id = mastery.ensureConcept('  间隔重复  ', 'wiki/concepts/间隔重复.md');
  assert.equal(mastery.ensureConcept('间隔重复', null), id);
  assert.equal(mastery.ensureConcept('间隔重复', 'wiki/concepts/other.md'), id);
  assert.equal(countRows(ldb.db, 'SELECT COUNT(*) AS n FROM concepts'), 1);
  // Trim only: case is preserved (it can be meaningful for wiki paths).
  const upper = mastery.ensureConcept('Spaced Repetition', null);
  const lower = mastery.ensureConcept('spaced repetition', null);
  assert.notEqual(upper, lower);
  assert.equal(countRows(ldb.db, 'SELECT COUNT(*) AS n FROM concepts'), 3);
  assert.throws(() => mastery.ensureConcept('   ', null), /non-empty concept name/);
  ldb.close();
});

test('ensureConcept fails loudly when the row cannot be read back (A20)', () => {
  const ldb = new LearningDb(':memory:');
  const mastery = new MasteryStore(ldb);
  type PrepareFn = LearningDb['db']['prepare'];
  const realPrepare = ldb.db.prepare.bind(ldb.db) as PrepareFn;
  let hideReadBack = true;
  (ldb.db as unknown as { prepare: PrepareFn }).prepare = ((sql: string) => {
    const stmt = realPrepare(sql);
    if (!hideReadBack || !/SELECT id FROM concepts WHERE name/.test(sql)) return stmt;
    hideReadBack = false;
    // Simulate the checked re-read coming back empty (e.g. another process
    // deleted the row between the INSERT OR IGNORE and the read).
    return new Proxy(stmt, {
      get(target, prop, receiver) {
        if (prop === 'get') return () => undefined;
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  }) as PrepareFn;
  assert.throws(() => mastery.ensureConcept('c1', null), /missing after insert/);
  (ldb.db as unknown as { prepare: PrepareFn }).prepare = realPrepare;
  ldb.close();
});

test('ensureConcept links a wiki path onto an existing concept (A23)', () => {
  const ldb = new LearningDb(':memory:');
  const mastery = new MasteryStore(ldb);
  // The first answer may arrive before the wiki page exists.
  const id = mastery.ensureConcept('晚绑定', null);
  const pathOf = (conceptId: number): string | null =>
    (ldb.db.prepare('SELECT wiki_path FROM concepts WHERE id = ?').get(conceptId) as { wiki_path: string | null }).wiki_path;
  assert.equal(pathOf(id), null);
  // Supplying the path later must update the existing row instead of discarding it.
  assert.equal(mastery.ensureConcept('晚绑定', 'wiki/concepts/晚绑定.md'), id);
  assert.equal(pathOf(id), 'wiki/concepts/晚绑定.md');
  // A later null means "no page information in this call", not "clear the page".
  assert.equal(mastery.ensureConcept('晚绑定', null), id);
  assert.equal(pathOf(id), 'wiki/concepts/晚绑定.md');
  assert.equal(countRows(ldb.db, 'SELECT COUNT(*) AS n FROM concepts'), 1);
  ldb.close();
});

test('recordLevel rejects non-finite/out-of-range levels and unknown sources (A22)', () => {
  const ldb = new LearningDb(':memory:');
  const mastery = new MasteryStore(ldb);
  const conceptId = mastery.ensureConcept('c1', null);
  assert.throws(() => mastery.recordLevel(conceptId, Number.NaN, 'first_answer'), /finite number/);
  assert.throws(() => mastery.recordLevel(conceptId, Number.POSITIVE_INFINITY, 'first_answer'), /finite number/);
  assert.throws(() => mastery.recordLevel(conceptId, -0.1, 'first_answer'), /within 0\.\.1/);
  assert.throws(() => mastery.recordLevel(conceptId, 1.1, 'first_answer'), /within 0\.\.1/);
  assert.throws(() => mastery.recordLevel(conceptId, 0.5, 'llm_says_so'), /unknown mastery source/);
  assert.equal(countRows(ldb.db, 'SELECT COUNT(*) AS n FROM mastery_history'), 0);
  // Every documented source is accepted at the boundaries.
  for (const source of MASTERY_SOURCES) mastery.recordLevel(conceptId, 0.5, source);
  mastery.recordLevel(conceptId, 0, 'first_answer');
  mastery.recordLevel(conceptId, 1, 'model_rating');
  assert.equal(mastery.recentLevels(conceptId, 10).length, MASTERY_SOURCES.length + 2);
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

test('applyAttempt is one conditional UPSERT, not a read-modify-write (A25)', () => {
  const ldb = new LearningDb(':memory:');
  const review = new ReviewStore(ldb);
  const prepared: string[] = [];
  type PrepareFn = LearningDb['db']['prepare'];
  const realPrepare = ldb.db.prepare.bind(ldb.db) as PrepareFn;
  (ldb.db as unknown as { prepare: PrepareFn }).prepare = ((sql: string) => {
    prepared.push(sql);
    return realPrepare(sql);
  }) as PrepareFn;

  const first = review.applyAttempt('q1', true);
  const reviewStatements = prepared.filter((sql) => /review_schedule/i.test(sql));
  assert.equal(reviewStatements.length, 2); // the atomic upsert + the checked read-back
  assert.match(reviewStatements[0], /INSERT INTO review_schedule/);
  assert.match(reviewStatements[0], /ON CONFLICT\(question_id\) DO UPDATE/);
  assert.match(reviewStatements[0], /CASE WHEN excluded\.last_result = 'correct'/);
  assert.doesNotMatch(reviewStatements[0], /^\s*SELECT/i);
  assert.equal((review.get('q1') as { interval_days: number }).interval_days, first.intervalDays);

  // The returned next_review is canonical ISO-8601 so lexicographic due-date
  // comparisons stay correct.
  assert.equal(new Date(first.nextReview).toISOString(), first.nextReview);
  ldb.close();
});

test('applyAttempt guards a non-numeric stored interval (A25)', () => {
  const ldb = new LearningDb(':memory:');
  const review = new ReviewStore(ldb);
  review.applyAttempt('q1', true);
  ldb.db.prepare("UPDATE review_schedule SET interval_days = 'bogus' WHERE question_id = 'q1'").run();
  const result = review.applyAttempt('q1', true);
  assert.equal(result.intervalDays, 2); // fallback interval 1 day, doubled
  const stored = review.get('q1') as { interval_days: number; correct_streak: number };
  assert.equal(stored.interval_days, 2);
  assert.equal(stored.correct_streak, 2);
  assert.ok(Number.isInteger(stored.interval_days));
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

test('constructor closes the connection when post-open setup fails (A1)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ldb-init-'));
  const file = join(dir, 'bad.db');
  try {
    const seed = new DatabaseSync(file);
    // A schema_version table with the wrong shape: the migration probe must
    // throw (it is not a first run), i.e. post-open setup fails after open.
    seed.exec('CREATE TABLE schema_version (other TEXT)');
    seed.close();
    const proto = DatabaseSync.prototype as unknown as { close: () => void };
    const realClose = proto.close;
    let closeCalls = 0;
    proto.close = function (this: DatabaseSync) {
      closeCalls += 1;
      return realClose.call(this);
    };
    try {
      assert.throws(() => new LearningDb(file), /no such column: version/);
    } finally {
      proto.close = realClose;
    }
    assert.equal(closeCalls, 1, 'the constructor must close the connection before rethrowing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('directory creation failures keep their root cause (A2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ldb-dir-'));
  const blocker = join(dir, 'blocked');
  try {
    writeFileSync(blocker, 'not a directory');
    assert.throws(
      () => new LearningDb(join(blocker, 'nested', 'learning.db')),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /cannot create learning database directory/);
        const cause = (err as { cause?: unknown }).cause;
        assert.ok(cause instanceof Error, 'the filesystem error must be preserved as cause');
        assert.equal((cause as { code?: string }).code, 'ENOTDIR');
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('close is idempotent (A4)', () => {
  const ldb = new LearningDb(':memory:');
  ldb.close();
  // DatabaseSync.close() throws when called twice; LearningDb.close must not.
  ldb.close();
});

test('file databases enable WAL and busy_timeout, memory databases skip the WAL assertion (A5)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ldb-wal-'));
  const file = join(dir, 'learning.db');
  try {
    const ldb = new LearningDb(file);
    assert.equal((ldb.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, 'wal');
    assert.equal((ldb.db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout, 5000);
    ldb.close();
    // :memory: legitimately reports "memory"; it must still get the timeout.
    const mem = new LearningDb(':memory:');
    assert.equal((mem.db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout, 5000);
    mem.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('connection invariants reject a file database that is not in WAL mode (A5)', () => {
  const db = new DatabaseSync(':memory:');
  try {
    // A memory connection cannot satisfy the WAL requirement of a file path.
    assert.throws(() => applyConnectionInvariants(db, '/tmp/claims-to-be-a-file.db'), /WAL journal mode/);
  } finally {
    db.close();
  }
});

test('opening a database written by a newer schema version fails clearly (A33)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ldb-newer-'));
  const file = join(dir, 'learning.db');
  try {
    const ldb = new LearningDb(file);
    ldb.close();
    const raw = new DatabaseSync(file);
    raw.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(99, NOW);
    raw.close();
    assert.throws(() => new LearningDb(file), /newer than the supported version/);
    // The failed open must not mutate the database: dropping the bogus row
    // makes it openable again.
    const repair = new DatabaseSync(file);
    repair.prepare('DELETE FROM schema_version WHERE version = 99').run();
    repair.close();
    const reopened = new LearningDb(file);
    assert.equal(reopened.schemaVersion(), SCHEMA_VERSION);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('question create validates required fields and defaults reference to null (A7)', () => {
  const ldb = new LearningDb(':memory:');
  const questions = new QuestionStore(ldb);
  const base = { questionId: 'q1', version: 1, type: 'concept', topic: 't', prompt: 'p' };
  assert.throws(() => questions.create({ ...base, questionId: '' }), /non-empty questionId/);
  assert.throws(() => questions.create({ ...base, type: '   ' }), /non-empty type/);
  assert.throws(() => questions.create({ ...base, topic: '' }), /non-empty topic/);
  assert.throws(() => questions.create({ ...base, prompt: '' }), /non-empty prompt/);
  assert.throws(() => questions.create({ ...base, version: 0 }), /positive integer version/);
  assert.throws(() => questions.create({ ...base, version: 1.5 }), /positive integer version/);
  // Omitted reference is stored as NULL, not as a binding error.
  questions.create(base);
  const row = ldb.db.prepare("SELECT reference FROM questions WHERE question_id = 'q1'").get() as { reference: string | null };
  assert.equal(row.reference, null);
  ldb.close();
});

test('history queries coerce invalid limits to their defaults (A10)', () => {
  const ldb = new LearningDb(':memory:');
  const questions = new QuestionStore(ldb);
  questions.create({ questionId: 'q1', version: 1, type: 'concept', topic: 't', prompt: 'p', reference: null });
  const attempts = new AttemptStore(ldb);
  for (let i = 0; i < 15; i += 1) attempts.record({ attemptId: `a${i}`, questionId: 'q1', questionVersion: 1, result: 'correct' });
  assert.equal(attempts.recentFor('q1', 3).length, 3);
  // SQLite treats LIMIT -1 as "unlimited"; the store must fall back to 10.
  assert.equal(attempts.recentFor('q1', -1).length, 10);
  assert.equal(attempts.recentFor('q1', 0).length, 10);
  assert.equal(attempts.recentFor('q1', Number.NaN).length, 10);
  const mastery = new MasteryStore(ldb);
  const conceptId = mastery.ensureConcept('c', null);
  for (let i = 0; i < 8; i += 1) mastery.recordLevel(conceptId, 0.5, 'first_answer');
  assert.equal(mastery.recentLevels(conceptId, 2).length, 2);
  assert.equal(mastery.recentLevels(conceptId, -5).length, 5);
  ldb.close();
});

test('attempt record rejects results/phases outside the allowed unions (A13)', () => {
  const ldb = new LearningDb(':memory:');
  const questions = new QuestionStore(ldb);
  questions.create({ questionId: 'q1', version: 1, type: 'concept', topic: 't', prompt: 'p', reference: null });
  const attempts = new AttemptStore(ldb);
  const base = { attemptId: 'a1', questionId: 'q1', questionVersion: 1 };
  assert.throws(() => attempts.record({ ...base, result: 'bogus' as unknown as AttemptResult }), /invalid attempt result/);
  assert.throws(() => attempts.record({ ...base, result: 'correct', phase: 'nope' as unknown as PracticePhase }), /invalid practice phase/);
  assert.equal(attempts.count(), 0);
  attempts.record({ ...base, result: 'correct', phase: 'correction' });
  assert.equal(attempts.count(), 1);
  ldb.close();
});

test('recentFor orders by answer time and accepts a canonical answeredAt (A11/A12)', () => {
  const ldb = new LearningDb(':memory:');
  const questions = new QuestionStore(ldb);
  questions.create({ questionId: 'q1', version: 1, type: 'concept', topic: 't', prompt: 'p', reference: null });
  const attempts = new AttemptStore(ldb);
  const early = '2026-01-01T00:00:00.000Z';
  const late = '2026-01-02T00:00:00.000Z';
  // Inserted first, answered last.
  attempts.record({ attemptId: 'a_late', questionId: 'q1', questionVersion: 1, result: 'correct', answeredAt: late });
  // Backfilled after a_late: inserted later, but answered earlier.
  attempts.record({ attemptId: 'a_early', questionId: 'q1', questionVersion: 1, result: 'incorrect', answeredAt: early });
  // History is ordered by answered_at, so insert order cannot put the backfill
  // on top; the supplied timestamp is stored verbatim, not replaced by "now".
  assert.deepEqual(attempts.recentFor('q1').map((r) => r.attempt_id), ['a_late', 'a_early']);
  assert.equal(attempts.recentFor('q1')[1].answered_at, early);
  // Insert id is only the tie-breaker for identical answer times.
  attempts.record({ attemptId: 'a_tie1', questionId: 'q1', questionVersion: 1, result: 'correct', answeredAt: late });
  attempts.record({ attemptId: 'a_tie2', questionId: 'q1', questionVersion: 1, result: 'correct', answeredAt: late });
  assert.deepEqual(attempts.recentFor('q1', 2).map((r) => r.attempt_id), ['a_tie2', 'a_tie1']);
  ldb.close();
});

test('attempt record rejects a non-canonical answeredAt and defaults to now (A12)', () => {
  const ldb = new LearningDb(':memory:');
  const questions = new QuestionStore(ldb);
  questions.create({ questionId: 'q1', version: 1, type: 'concept', topic: 't', prompt: 'p', reference: null });
  const attempts = new AttemptStore(ldb);
  const base = { attemptId: 'a1', questionId: 'q1', questionVersion: 1, result: 'correct' as const };
  // Valid instant, non-canonical serialization: ordering by string would break.
  assert.throws(() => attempts.record({ ...base, answeredAt: '2026-01-01T00:00:00Z' }), /canonical UTC ISO-8601/);
  assert.throws(() => attempts.record({ ...base, answeredAt: 'not-a-date' }), /not a valid ISO-8601/);
  assert.throws(() => attempts.record({ ...base, answeredAt: '' }), /non-empty ISO-8601/);
  assert.throws(() => attempts.record({ ...base, answeredAt: 123 as unknown as string }), /non-empty ISO-8601/);
  assert.equal(attempts.count(), 0);
  // Omitted answeredAt still defaults to the current canonical time.
  const before = Date.now();
  attempts.record(base);
  const stored = ldb.db.prepare("SELECT answered_at FROM attempts WHERE attempt_id = 'a1'").get() as { answered_at: string };
  assert.ok(Date.parse(stored.answered_at) >= before - 1000);
  assert.equal(new Date(stored.answered_at).toISOString(), stored.answered_at);
  ldb.close();
});

test('recentFor returns typed rows without the internal id column (A30)', () => {
  const ldb = new LearningDb(':memory:');
  const questions = new QuestionStore(ldb);
  questions.create({ questionId: 'q1', version: 1, type: 'concept', topic: 't', prompt: 'p', reference: null });
  const attempts = new AttemptStore(ldb);
  attempts.record({ attemptId: 'a1', questionId: 'q1', questionVersion: 1, result: 'correct', score: 1 });
  const [row] = attempts.recentFor('q1');
  assert.deepEqual(Object.keys(row).sort(), [
    'answer_summary',
    'answered_at',
    'attempt_id',
    'phase',
    'question_id',
    'question_version',
    'result',
    'score',
  ]);
  const typed: AttemptRow = row;
  assert.equal(typed.question_version, 1);
  assert.equal(typed.result, 'correct');
  ldb.close();
});

test('review policy constants define the interval growth and cap (A27)', () => {
  assert.equal(MIN_INTERVAL_DAYS, 1);
  assert.equal(MAX_INTERVAL_DAYS, 30);
  assert.equal(INTERVAL_GROWTH_FACTOR, 2);
  const ldb = new LearningDb(':memory:');
  const review = new ReviewStore(ldb);
  for (let i = 0; i < 10; i += 1) review.applyAttempt('q1', true);
  assert.equal((review.get('q1') as ReviewSchedule).interval_days, MAX_INTERVAL_DAYS);
  ldb.close();
});

test('dueQuestionIds orders by next_review and bounds the limit (A28)', () => {
  const ldb = new LearningDb(':memory:');
  const review = new ReviewStore(ldb);
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  const insert = ldb.db.prepare('INSERT INTO review_schedule (question_id, interval_days, correct_streak, next_review, updated_at) VALUES (?, 1, 0, ?, ?)');
  const total = DEFAULT_DUE_LIMIT + 5;
  for (let i = 0; i < total; i += 1) {
    insert.run(`q${i}`, new Date(base + i * 60_000).toISOString(), NOW);
  }
  const now = new Date('2026-02-01T00:00:00Z');
  const due = review.dueQuestionIds(now);
  assert.equal(due.length, DEFAULT_DUE_LIMIT);
  assert.equal(due[0], 'q0');
  assert.equal(due[DEFAULT_DUE_LIMIT - 1], `q${DEFAULT_DUE_LIMIT - 1}`);
  // Invalid limits fall back to the default instead of SQLite's unlimited -1.
  assert.equal(review.dueQuestionIds(now, -1).length, DEFAULT_DUE_LIMIT);
  assert.deepEqual(review.dueQuestionIds(now, 2), ['q0', 'q1']);
  assert.equal(review.dueQuestionIds(now, total).length, total);
  assert.throws(() => review.dueQuestionIds(new Date('not a date')), /valid Date/);
  ldb.close();
});

test('review timestamps are canonical ISO and non-canonical values are rejected on read (A29)', () => {
  const ldb = new LearningDb(':memory:');
  const review = new ReviewStore(ldb);
  const applied = review.applyAttempt('q1', true);
  // Exactly the serialization Date#toISOString() produces.
  assert.equal(new Date(applied.nextReview).toISOString(), applied.nextReview);
  assert.equal(toCanonicalIso(applied.nextReview, 'next_review'), applied.nextReview);
  const row = review.get('q1') as ReviewSchedule;
  assert.equal(row.next_review, applied.nextReview);
  // Valid date, non-canonical serialization: unreadable by design (A29).
  ldb.db.prepare("UPDATE review_schedule SET next_review = '2026-01-01T00:00:00Z' WHERE question_id = 'q1'").run();
  assert.throws(() => review.get('q1'), /canonical UTC ISO-8601/);
  ldb.db.prepare("UPDATE review_schedule SET next_review = 'not-a-date' WHERE question_id = 'q1'").run();
  assert.throws(() => review.get('q1'), /not a valid ISO-8601/);
  ldb.close();
});

test('review get returns a typed ReviewSchedule row with explicit columns (A30)', () => {
  const ldb = new LearningDb(':memory:');
  const review = new ReviewStore(ldb);
  review.applyAttempt('q1', true);
  const row = review.get('q1') as ReviewSchedule;
  assert.deepEqual(Object.keys(row).sort(), ['correct_streak', 'interval_days', 'last_result', 'next_review', 'question_id', 'updated_at']);
  assert.equal(typeof row.interval_days, 'number');
  assert.equal(row.last_result, 'correct');
  ldb.close();
});

test('recentLevels returns typed mastery evidence (A24)', () => {
  const ldb = new LearningDb(':memory:');
  const mastery = new MasteryStore(ldb);
  const conceptId = mastery.ensureConcept('c1', null);
  mastery.recordLevel(conceptId, 0.5, 'first_answer');
  const evidence: MasteryEvidence[] = mastery.recentLevels(conceptId);
  assert.equal(evidence.length, 1);
  assert.deepEqual(Object.keys(evidence[0]).sort(), ['level', 'recorded_at', 'source']);
  assert.equal(evidence[0].level, 0.5);
  assert.equal(evidence[0].source, 'first_answer');
  assert.equal(typeof evidence[0].recorded_at, 'string');
  ldb.close();
});

test('byTopic filters one topic, keeps newest rows bounded, and reports its own operation', () => {
  const ldb = new LearningDb(':memory:');
  const questions = new QuestionStore(ldb);
  questions.create({ questionId: 'q1', version: 1, type: 'concept', topic: 'A', prompt: 'p' });
  questions.create({ questionId: 'q1', version: 2, type: 'concept', topic: 'A', prompt: 'p2' });
  questions.create({ questionId: 'q2', version: 1, type: 'concept', topic: 'A', prompt: 'p' });
  questions.create({ questionId: 'q3', version: 1, type: 'concept', topic: 'B', prompt: 'p' });

  // Newest first, and a question with two versions appears twice.
  assert.deepEqual(questions.byTopic('A').map((row) => row.questionId), ['q2', 'q1', 'q1']);
  // The limit bounds the summary even when the topic keeps accumulating.
  assert.deepEqual(questions.byTopic('A', 1).map((row) => row.questionId), ['q2']);
  assert.deepEqual(questions.byTopic('B').map((row) => row.questionId), ['q3']);
  // The error names byTopic, not create, so logs point at the failing caller.
  assert.throws(() => questions.byTopic('  '), /question\.byTopic requires a non-empty topic/);
  ldb.close();
});

test('countByResult aggregates distinct question ids and tolerates an empty set', () => {
  const ldb = new LearningDb(':memory:');
  const questions = new QuestionStore(ldb);
  questions.create({ questionId: 'q1', version: 1, type: 'concept', topic: 't', prompt: 'p' });
  questions.create({ questionId: 'q2', version: 1, type: 'concept', topic: 't', prompt: 'p' });
  const attempts = new AttemptStore(ldb);
  attempts.record({ attemptId: 'a1', questionId: 'q1', questionVersion: 1, result: 'incorrect' });
  attempts.record({ attemptId: 'a2', questionId: 'q1', questionVersion: 1, result: 'correct' });
  attempts.record({ attemptId: 'a3', questionId: 'q2', questionVersion: 1, result: 'incorrect' });

  // Duplicate ids are collapsed before building the IN list.
  const counts = attempts.countByResult(['q1', 'q1', 'q2']);
  assert.equal(counts.total, 3);
  assert.deepEqual(counts.byResult, { incorrect: 2, correct: 1 });
  assert.deepEqual(attempts.countByResult([]), { total: 0, byResult: {} });
  ldb.close();
});
