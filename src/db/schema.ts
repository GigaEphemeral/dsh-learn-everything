// SQLite schema and migrations for learning state (S2, decision B).
// Learning data (questions/attempts/ratings/mastery/review) lives ONLY here,
// never in Obsidian notes.

import type { DatabaseSync } from 'node:sqlite';

// Each entry is one migration; version = index + 1. Entries are append-only:
// release a new version by adding a string, never by editing an old one (old
// databases replay the historical steps they have not applied yet).
export const MIGRATIONS: readonly string[] = [
  // v1: initial learning-state schema. Kept verbatim so an existing v1 database
  // is recognised and upgraded by v2 instead of being rebuilt from scratch.
  [
    "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS concepts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, wiki_path TEXT, created_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id TEXT NOT NULL UNIQUE, version INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL, topic TEXT NOT NULL, prompt TEXT NOT NULL, reference TEXT, created_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL UNIQUE, question_id TEXT NOT NULL REFERENCES questions(question_id), question_version INTEGER NOT NULL, answered_at TEXT NOT NULL, result TEXT NOT NULL, score REAL, answer_summary TEXT, phase TEXT NOT NULL DEFAULT 'first');",
    "CREATE TABLE IF NOT EXISTS ratings (id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id), model_rating REAL, feedback TEXT, error_analysis TEXT, suggestions TEXT, rated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS mastery_history (id INTEGER PRIMARY KEY AUTOINCREMENT, concept_id INTEGER NOT NULL REFERENCES concepts(id), level REAL NOT NULL, source TEXT NOT NULL, recorded_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS review_schedule (question_id TEXT PRIMARY KEY REFERENCES questions(question_id), interval_days INTEGER NOT NULL DEFAULT 1, correct_streak INTEGER NOT NULL DEFAULT 0, last_result TEXT, next_review TEXT NOT NULL, updated_at TEXT NOT NULL);",
  ].join('\n'),
  // v2: one question id may have several versions, and an attempt must point at
  // the exact version it answered. SQLite cannot alter an existing UNIQUE
  // constraint or add CHECK constraints, so the affected tables are rebuilt
  // (create -> copy -> drop -> rename); migrate() disables foreign keys around
  // the migration transaction for exactly that reason.
  [
    // Composite question uniqueness replaces the old single-column rule.
    "CREATE TABLE questions_v2 (id INTEGER PRIMARY KEY AUTOINCREMENT, question_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL, topic TEXT NOT NULL, prompt TEXT NOT NULL, reference TEXT, created_at TEXT NOT NULL, UNIQUE (question_id, version));",
    "INSERT INTO questions_v2 (id, question_id, version, type, topic, prompt, reference, created_at) SELECT id, question_id, version, type, topic, prompt, reference, created_at FROM questions;",
    // Attempts reference the exact (question_id, question_version) pair.
    "CREATE TABLE attempts_v2 (id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL UNIQUE, question_id TEXT NOT NULL, question_version INTEGER NOT NULL, answered_at TEXT NOT NULL, result TEXT NOT NULL CHECK (result IN ('correct', 'incorrect', 'partial')), score REAL, answer_summary TEXT, phase TEXT NOT NULL DEFAULT 'first' CHECK (phase IN ('first', 'correction', 'variant')), FOREIGN KEY (question_id, question_version) REFERENCES questions(question_id, version));",
    "INSERT INTO attempts_v2 (id, attempt_id, question_id, question_version, answered_at, result, score, answer_summary, phase) SELECT id, attempt_id, question_id, question_version, answered_at, result, score, answer_summary, phase FROM attempts;",
    "DROP TABLE attempts;",
    "DROP TABLE questions;",
    "ALTER TABLE questions_v2 RENAME TO questions;",
    "ALTER TABLE attempts_v2 RENAME TO attempts;",
    // Mastery evidence gets a 0..1 level domain and a source whitelist.
    "CREATE TABLE mastery_history_v2 (id INTEGER PRIMARY KEY AUTOINCREMENT, concept_id INTEGER NOT NULL REFERENCES concepts(id), level REAL NOT NULL CHECK (level >= 0 AND level <= 1), source TEXT NOT NULL CHECK (source IN ('first_answer', 'model_rating', 'correction', 'variant_pass')), recorded_at TEXT NOT NULL);",
    "INSERT INTO mastery_history_v2 (id, concept_id, level, source, recorded_at) SELECT id, concept_id, level, source, recorded_at FROM mastery_history;",
    "DROP TABLE mastery_history;",
    "ALTER TABLE mastery_history_v2 RENAME TO mastery_history;",
    // Review schedule is keyed by question id (not by version): one schedule per
    // question, tracking the latest answer. The v1 FK on question_id is dropped
    // because question_id is no longer unique on its own; applyAttempt is the
    // only writer and is always called for a question that was just attempted.
    "CREATE TABLE review_schedule_v2 (question_id TEXT PRIMARY KEY, interval_days INTEGER NOT NULL DEFAULT 1 CHECK (interval_days >= 1), correct_streak INTEGER NOT NULL DEFAULT 0 CHECK (correct_streak >= 0), last_result TEXT, next_review TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "INSERT INTO review_schedule_v2 (question_id, interval_days, correct_streak, last_result, next_review, updated_at) SELECT question_id, interval_days, correct_streak, last_result, next_review, updated_at FROM review_schedule;",
    "DROP TABLE review_schedule;",
    "ALTER TABLE review_schedule_v2 RENAME TO review_schedule;",
    // A34: indexes for queries that grow with learning history.
    "CREATE INDEX IF NOT EXISTS idx_attempts_question ON attempts(question_id);",
    "CREATE INDEX IF NOT EXISTS idx_ratings_attempt ON ratings(attempt_id);",
    "CREATE INDEX IF NOT EXISTS idx_mastery_history_concept ON mastery_history(concept_id);",
    "CREATE INDEX IF NOT EXISTS idx_review_schedule_next ON review_schedule(next_review);",
  ].join('\n'),
];

export const SCHEMA_VERSION = MIGRATIONS.length;

// The probe below is the only legitimate "schema not created yet" signal; any
// other error (corruption, permissions, unexpected schema) must surface instead
// of being treated as a first run.
function isMissingSchemaVersionTable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /no such table:\s*schema_version/i.test(message);
}

function readAppliedVersions(db: DatabaseSync): Set<number> {
  const applied = new Set<number>();
  try {
    const rows = db.prepare('SELECT version FROM schema_version').all() as Array<{ version: number }>;
    for (const row of rows) applied.add(row.version);
  } catch (err) {
    if (!isMissingSchemaVersionTable(err)) throw err;
  }
  return applied;
}

// Apply every pending migration atomically: the DDL and the schema_version row
// must commit together, otherwise a crash between them would re-run a migration
// on a half-built schema. node:sqlite has no transaction() helper, so this uses
// explicit BEGIN IMMEDIATE / COMMIT / ROLLBACK.
export function migrate(db: DatabaseSync): void {
  // Table rebuilds drop and recreate parent tables, so foreign key enforcement
  // must be off while they run (and PRAGMA foreign_keys is a no-op inside a
  // transaction, hence it is toggled before BEGIN and after COMMIT/ROLLBACK).
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.exec('BEGIN IMMEDIATE;');
    try {
      const applied = readAppliedVersions(db);
      // A33: never silently operate on a database written by a newer build
      // (it may contain columns/constraints this code does not know about).
      let storedMax = 0;
      for (const version of applied) {
        if (version > storedMax) storedMax = version;
      }
      if (storedMax > MIGRATIONS.length) {
        throw new Error(
          `learning database schema version ${storedMax} is newer than the supported version ${MIGRATIONS.length}; upgrade the plugin before opening this database`,
        );
      }
      for (let i = 0; i < MIGRATIONS.length; i += 1) {
        const version = i + 1;
        if (applied.has(version)) continue;
        db.exec(MIGRATIONS[i]);
        db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
      }
      db.exec('COMMIT;');
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch { /* the transaction may already be rolled back */ }
      throw err;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}
