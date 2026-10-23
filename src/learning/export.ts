// Learning-state snapshot export (S2): full, deterministic JSON of the SQLite
// learning data for viewing/backing up outside the runtime.

import type { LearningDb } from '../db/client.js';

export interface LearningSnapshot {
  schemaVersion: number;
  counts: {
    questions: number;
    attempts: number;
    ratings: number;
    concepts: number;
    masteryEvents: number;
    reviewEntries: number;
  };
  questions: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  ratings: Array<Record<string, unknown>>;
  mastery: Array<Record<string, unknown>>;
  review: Array<Record<string, unknown>>;
}

export function buildSnapshot(ldb: LearningDb): LearningSnapshot {
  const count = (t: string): number => (ldb.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  const all = (sql: string): Array<Record<string, unknown>> => ldb.db.prepare(sql).all() as Array<Record<string, unknown>>;
  return {
    schemaVersion: ldb.schemaVersion(),
    counts: {
      questions: count('questions'),
      attempts: count('attempts'),
      ratings: count('ratings'),
      concepts: count('concepts'),
      masteryEvents: count('mastery_history'),
      reviewEntries: count('review_schedule'),
    },
    questions: all('SELECT * FROM questions ORDER BY id'),
    attempts: all('SELECT * FROM attempts ORDER BY id'),
    ratings: all('SELECT * FROM ratings ORDER BY id'),
    mastery: all('SELECT * FROM mastery_history ORDER BY id'),
    review: all('SELECT * FROM review_schedule ORDER BY question_id'),
  };
}
