// Unit tests for the SQLite learning-state layer (S2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LearningDb } from '../src/db/client.js';
import { MIGRATIONS, SCHEMA_VERSION, migrate } from '../src/db/schema.js';
import { AttemptStore } from '../src/learning/attempts.js';
import { QuestionStore } from '../src/learning/questions.js';
import { ReviewStore } from '../src/learning/review.js';
import { MASTERY_SOURCES, MasteryStore } from '../src/learning/mastery.js';
const NOW = '2026-01-01T00:00:00.000Z';
function indexNames(db) {
    return db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name").all().map((r) => r.name);
}
function countRows(db, sql) {
    const row = db.prepare(sql).get();
    return row.n;
}
// Seed a database exactly as the released v1 schema left it: schema_version=1
// plus real question/attempt/rating/mastery/review rows.
function seedV1Database(filePath) {
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
    }
    finally {
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
    assert.throws(() => ldb.db.prepare("INSERT INTO attempts (attempt_id, question_id, question_version, answered_at, result) VALUES ('x1', 'q1', 1, ?, 'bogus')").run(NOW), /CHECK constraint failed: result/);
    assert.throws(() => ldb.db.prepare("INSERT INTO attempts (attempt_id, question_id, question_version, answered_at, result, phase) VALUES ('x2', 'q1', 1, ?, 'correct', 'nope')").run(NOW), /CHECK constraint failed: phase/);
    // mastery_history.level 0..1 and source whitelist
    ldb.db.prepare('INSERT INTO concepts (name, wiki_path, created_at) VALUES (?, ?, ?)').run('c1', null, NOW);
    assert.throws(() => ldb.db.prepare('INSERT INTO mastery_history (concept_id, level, source, recorded_at) VALUES (1, 1.5, ?, ?)').run('first_answer', NOW), /CHECK constraint failed: level/);
    assert.throws(() => ldb.db.prepare('INSERT INTO mastery_history (concept_id, level, source, recorded_at) VALUES (1, 0.5, ?, ?)').run('llm_said_so', NOW), /CHECK constraint failed: source/);
    // review_schedule.interval_days >= 1 and correct_streak >= 0
    assert.throws(() => ldb.db.prepare('INSERT INTO review_schedule (question_id, interval_days, correct_streak, next_review, updated_at) VALUES (?, 0, 0, ?, ?)').run('q1', NOW, NOW), /CHECK constraint failed: interval_days/);
    assert.throws(() => ldb.db.prepare('INSERT INTO review_schedule (question_id, interval_days, correct_streak, next_review, updated_at) VALUES (?, 1, -1, ?, ?)').run('q1', NOW, NOW), /CHECK constraint failed: correct_streak/);
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
    assert.throws(() => questions.create({ questionId: 'q1', version: 1, type: 'concept', topic: 't', prompt: 'dup', reference: null }), /UNIQUE constraint failed: questions\.question_id, questions\.version/);
    // Attempts link to the exact version and the FK rejects unknown versions.
    const attempts = new AttemptStore(ldb);
    attempts.record({ attemptId: 'a1', questionId: 'q1', questionVersion: 2, result: 'correct', score: 1, answerSummary: null, phase: 'variant' });
    assert.equal(attempts.recentFor('q1')[0].question_version, 2);
    assert.throws(() => attempts.record({ attemptId: 'a2', questionId: 'q1', questionVersion: 9, result: 'correct' }), /FOREIGN KEY constraint failed/);
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
        assert.equal(ldb.db.prepare("SELECT model_rating FROM ratings WHERE attempt_id = 'a1'").get().model_rating, 2);
        assert.equal(countRows(ldb.db, 'SELECT COUNT(*) AS n FROM mastery_history'), 1);
        assert.equal(ldb.db.prepare("SELECT interval_days FROM review_schedule WHERE question_id = 'q1'").get().interval_days, 1);
        // The v1 -> v2 upgrade unlocks the new version model.
        questions.create({ questionId: 'q1', version: 2, type: 'concept', topic: '间隔重复', prompt: '解释间隔重复（第二版）', reference: null });
        assert.equal(questions.get('q1')?.version, 2);
        attempts.record({ attemptId: 'a2', questionId: 'q1', questionVersion: 2, result: 'correct', score: 1, answerSummary: null, phase: 'variant' });
        assert.equal(attempts.count(), 2);
        assert.throws(() => attempts.record({ attemptId: 'a3', questionId: 'q1', questionVersion: 9, result: 'correct' }), /FOREIGN KEY constraint failed/);
        assert.deepEqual(ldb.db.prepare('PRAGMA foreign_key_check').all(), []);
        ldb.close();
        // Re-opening an already migrated database must not re-run the migration.
        const reopened = new LearningDb(file);
        assert.equal(reopened.schemaVersion(), 2);
        assert.equal(countRows(reopened.db, 'SELECT COUNT(*) AS n FROM schema_version'), 2);
        assert.equal(new AttemptStore(reopened).count(), 2);
        reopened.close();
    }
    finally {
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
        const realPrepare = db.prepare.bind(db);
        let injected = false;
        const injectPrepare = ((sql) => {
            const stmt = realPrepare(sql);
            if (injected || !/^INSERT INTO schema_version/i.test(sql))
                return stmt;
            injected = true;
            // Fail the version-row insert after the v2 DDL has run: without an
            // explicit transaction the half-migrated DDL would remain committed.
            return new Proxy(stmt, {
                get(target, prop, receiver) {
                    if (prop === 'run') {
                        return () => { throw new Error('injected version-row failure'); };
                    }
                    const value = Reflect.get(target, prop, receiver);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
        });
        db.prepare = injectPrepare;
        assert.throws(() => migrate(db), /injected version-row failure/);
        // DDL was rolled back: still exactly the v1 schema version...
        assert.deepEqual(db.prepare('SELECT version FROM schema_version ORDER BY version').all().map((r) => r.version), [1]);
        // ...and the v1 single-question-version rule still applies (proves the
        // questions table rebuild did not leak into the database).
        assert.throws(() => db.prepare('INSERT INTO questions (question_id, version, type, topic, prompt, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('q1', 2, 'concept', 't', 'p2', null, NOW), /UNIQUE constraint failed/);
        assert.equal(countRows(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%\\_v2' ESCAPE '\\'"), 0);
        assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
        // A retry after the transient failure upgrades cleanly.
        db.prepare = realPrepare;
        migrate(db);
        assert.deepEqual(db.prepare('SELECT version FROM schema_version ORDER BY version').all().map((r) => r.version), [1, 2]);
        db.prepare('INSERT INTO questions (question_id, version, type, topic, prompt, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('q1', 2, 'concept', 't', 'p2', null, NOW);
        assert.equal(countRows(db, "SELECT COUNT(*) AS n FROM questions WHERE question_id = 'q1'"), 2);
    }
    finally {
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
    }
    finally {
        db.close();
    }
});
test('attempt record validates required fields, defaults phase and normalises optionals (A9)', () => {
    const ldb = new LearningDb(':memory:');
    const questions = new QuestionStore(ldb);
    questions.create({ questionId: 'q1', version: 1, type: 'concept', topic: 't', prompt: 'p', reference: null });
    const attempts = new AttemptStore(ldb);
    const valid = { attemptId: 'a1', questionId: 'q1', questionVersion: 1, result: 'correct' };
    assert.throws(() => attempts.record({ ...valid, attemptId: '' }), /non-empty attemptId/);
    assert.throws(() => attempts.record({ ...valid, questionId: undefined }), /non-empty questionId/);
    assert.throws(() => attempts.record({ ...valid, questionVersion: undefined }), /finite questionVersion/);
    assert.throws(() => attempts.record({ ...valid, result: undefined }), /non-empty result/);
    // Optional fields omitted: phase defaults to "first", score/summary to null.
    attempts.record(valid);
    const row = ldb.db.prepare("SELECT phase, score, answer_summary FROM attempts WHERE attempt_id = 'a1'").get();
    assert.equal(row.phase, 'first');
    assert.equal(row.score, null);
    assert.equal(row.answer_summary, null);
    // Duplicate attempt ids keep their constraint cause but gain attempt/question context.
    assert.throws(() => attempts.record({ ...valid, result: 'incorrect' }), (err) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /a1/);
        assert.match(err.message, /q1/);
        assert.match(err.message, /UNIQUE constraint failed: attempts\.attempt_id/);
        return true;
    });
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
    const realPrepare = ldb.db.prepare.bind(ldb.db);
    let hideReadBack = true;
    ldb.db.prepare = ((sql) => {
        const stmt = realPrepare(sql);
        if (!hideReadBack || !/SELECT id FROM concepts WHERE name/.test(sql))
            return stmt;
        hideReadBack = false;
        // Simulate the checked re-read coming back empty (e.g. another process
        // deleted the row between the INSERT OR IGNORE and the read).
        return new Proxy(stmt, {
            get(target, prop, receiver) {
                if (prop === 'get')
                    return () => undefined;
                const value = Reflect.get(target, prop, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
    });
    assert.throws(() => mastery.ensureConcept('c1', null), /missing after insert/);
    ldb.db.prepare = realPrepare;
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
    for (const source of MASTERY_SOURCES)
        mastery.recordLevel(conceptId, 0.5, source);
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
    assert.equal(review.get('q1').interval_days, 1);
    review.applyAttempt('q1', true);
    assert.equal(review.get('q1').interval_days, 2);
    review.applyAttempt('q1', false);
    assert.equal(review.get('q1').interval_days, 1);
    assert.equal(review.get('q1').correct_streak, 0);
    ldb.close();
});
test('applyAttempt is one conditional UPSERT, not a read-modify-write (A25)', () => {
    const ldb = new LearningDb(':memory:');
    const review = new ReviewStore(ldb);
    const prepared = [];
    const realPrepare = ldb.db.prepare.bind(ldb.db);
    ldb.db.prepare = ((sql) => {
        prepared.push(sql);
        return realPrepare(sql);
    });
    const first = review.applyAttempt('q1', true);
    const reviewStatements = prepared.filter((sql) => /review_schedule/i.test(sql));
    assert.equal(reviewStatements.length, 2); // the atomic upsert + the checked read-back
    assert.match(reviewStatements[0], /INSERT INTO review_schedule/);
    assert.match(reviewStatements[0], /ON CONFLICT\(question_id\) DO UPDATE/);
    assert.match(reviewStatements[0], /CASE WHEN excluded\.last_result = 'correct'/);
    assert.doesNotMatch(reviewStatements[0], /^\s*SELECT/i);
    assert.equal(review.get('q1').interval_days, first.intervalDays);
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
    const stored = review.get('q1');
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
