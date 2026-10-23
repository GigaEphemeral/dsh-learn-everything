// Review scheduling state (S2). Simple, explainable interval doubling;
// priorities are computed per question (overdue / weak / novel). FSRS is
// deferred until real data shows a benefit.

import type { LearningDb } from '../db/client.js';
import { safeLimit } from './limits.js';

// Review policy constants (A27): explainable, easy to tune in one place.
export const MIN_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 30;
export const INTERVAL_GROWTH_FACTOR = 2;
export const DEFAULT_DUE_LIMIT = 50;

// The current interval is multiplied on a correct answer (clamped to the policy
// range) and reset to 1 day on a wrong answer. Interval/streak/next_review are
// all computed inside one conditional UPSERT so two writer processes (plugin
// and practice CLI) can never interleave a read-modify-write and lose an
// update. Non-numeric stored intervals fall back to 1 day instead of leaking
// NaN into the database (A26).
const CORRECT_INTERVAL_SQL =
  `MIN(MAX(${MIN_INTERVAL_DAYS}, (CASE WHEN typeof(review_schedule.interval_days) IN ('integer', 'real') ` +
  `THEN CAST(review_schedule.interval_days AS INTEGER) ELSE ${MIN_INTERVAL_DAYS} END) * ${INTERVAL_GROWTH_FACTOR}), ${MAX_INTERVAL_DAYS})`;
// strftime('%Y-%m-%dT%H:%M:%fZ') is exactly the shape of Date#toISOString(), so
// lexicographic "next_review <= now" comparisons stay correct (A29).
const NEXT_REVIEW_SQL =
  `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || (${CORRECT_INTERVAL_SQL}) || ' days')`;
const ONE_DAY_LATER_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day')";
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const APPLY_ATTEMPT_SQL = `
  INSERT INTO review_schedule (question_id, interval_days, correct_streak, last_result, next_review, updated_at)
  VALUES (?, ${MIN_INTERVAL_DAYS}, ?, ?, ${ONE_DAY_LATER_SQL}, ${NOW_SQL})
  ON CONFLICT(question_id) DO UPDATE SET
    interval_days = CASE WHEN excluded.last_result = 'correct' THEN ${CORRECT_INTERVAL_SQL} ELSE ${MIN_INTERVAL_DAYS} END,
    correct_streak = CASE WHEN excluded.last_result = 'correct'
      THEN COALESCE(review_schedule.correct_streak, 0) + 1 ELSE 0 END,
    last_result = excluded.last_result,
    next_review = CASE WHEN excluded.last_result = 'correct'
      THEN ${NEXT_REVIEW_SQL} ELSE ${ONE_DAY_LATER_SQL} END,
    updated_at = ${NOW_SQL}
`;

const SELECT_SCHEDULE_SQL =
  'SELECT question_id, interval_days, correct_streak, last_result, next_review, updated_at FROM review_schedule WHERE question_id = ?';

// Typed projection of a review_schedule row.
export interface ReviewSchedule {
  question_id: string;
  interval_days: number;
  correct_streak: number;
  last_result: string | null;
  next_review: string;
  updated_at: string;
}

// Validate an ISO-8601 timestamp and require it to be canonical UTC (the exact
// form Date#toISOString() produces). Lexicographic comparisons and cross-process
// scheduling both rely on that canonical form.
export function toCanonicalIso(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${label} must be a non-empty ISO-8601 string, got ${typeof value}`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`${label} is not a valid ISO-8601 timestamp: "${value}"`);
  }
  const canonical = new Date(ms).toISOString();
  if (canonical !== value) {
    throw new Error(`${label} must be canonical UTC ISO-8601 ("${canonical}"), got "${value}"`);
  }
  return canonical;
}

export class ReviewStore {
  constructor(private readonly ldb: LearningDb) {}

  applyAttempt(questionId: string, correct: boolean): { intervalDays: number; nextReview: string } {
    const lastResult = correct ? 'correct' : 'incorrect';
    const streak = correct ? 1 : 0;
    this.ldb.db.prepare(APPLY_ATTEMPT_SQL).run(questionId, streak, lastResult);
    const row = this.ldb.db.prepare(SELECT_SCHEDULE_SQL).get(questionId) as ReviewSchedule | undefined;
    if (!row) {
      throw new Error(`review schedule for question ${questionId} is missing after applyAttempt`);
    }
    // Write-side invariant: never persist a non-canonical next_review.
    toCanonicalIso(row.next_review, 'review_schedule.next_review');
    return { intervalDays: row.interval_days, nextReview: row.next_review };
  }

  get(questionId: string): ReviewSchedule | undefined {
    const row = this.ldb.db.prepare(SELECT_SCHEDULE_SQL).get(questionId) as ReviewSchedule | undefined;
    if (!row) return undefined;
    // Read-side invariant: a corrupt/legacy timestamp must be reported, not
    // silently treated as "not due".
    toCanonicalIso(row.next_review, 'review_schedule.next_review');
    return row;
  }

  // Due queue ordered by next_review, bounded by `limit` (invalid limits fall
  // back to DEFAULT_DUE_LIMIT instead of SQLite's negative-LIMIT = unlimited).
  dueQuestionIds(now = new Date(), limit = DEFAULT_DUE_LIMIT): string[] {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new Error('dueQuestionIds requires a valid Date');
    }
    const rows = this.ldb.db
      .prepare('SELECT question_id FROM review_schedule WHERE next_review <= ? ORDER BY next_review ASC LIMIT ?')
      .all(now.toISOString(), safeLimit(limit, DEFAULT_DUE_LIMIT)) as Array<{ question_id: string }>;
    return rows.map((row) => row.question_id);
  }
}
