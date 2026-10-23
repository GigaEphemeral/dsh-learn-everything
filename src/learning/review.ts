// Review scheduling state (S2). Simple, explainable interval doubling;
// priorities are computed per question (overdue / weak / novel). FSRS is
// deferred until real data shows a benefit.

import type { LearningDb } from '../db/client.js';

// The current interval is doubled on a correct answer (clamped to [1, 30] days)
// and reset to 1 day on a wrong answer. Interval/streak/next_review are all
// computed inside one conditional UPSERT so two writer processes (plugin and
// practice CLI) can never interleave a read-modify-write and lose an update.
// Non-numeric stored intervals fall back to 1 day instead of leaking NaN into
// the database.
const CORRECT_INTERVAL_SQL =
  "MIN(MAX(1, (CASE WHEN typeof(review_schedule.interval_days) IN ('integer', 'real') THEN CAST(review_schedule.interval_days AS INTEGER) ELSE 1 END) * 2), 30)";
const NEXT_REVIEW_SQL =
  `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || (${CORRECT_INTERVAL_SQL}) || ' days')`;
const ONE_DAY_LATER_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day')";
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const APPLY_ATTEMPT_SQL = `
  INSERT INTO review_schedule (question_id, interval_days, correct_streak, last_result, next_review, updated_at)
  VALUES (?, 1, ?, ?, ${ONE_DAY_LATER_SQL}, ${NOW_SQL})
  ON CONFLICT(question_id) DO UPDATE SET
    interval_days = CASE WHEN excluded.last_result = 'correct' THEN ${CORRECT_INTERVAL_SQL} ELSE 1 END,
    correct_streak = CASE WHEN excluded.last_result = 'correct'
      THEN COALESCE(review_schedule.correct_streak, 0) + 1 ELSE 0 END,
    last_result = excluded.last_result,
    next_review = CASE WHEN excluded.last_result = 'correct'
      THEN ${NEXT_REVIEW_SQL} ELSE ${ONE_DAY_LATER_SQL} END,
    updated_at = ${NOW_SQL}
`;

export class ReviewStore {
  constructor(private readonly ldb: LearningDb) {}

  applyAttempt(questionId: string, correct: boolean): { intervalDays: number; nextReview: string } {
    const lastResult = correct ? 'correct' : 'incorrect';
    const streak = correct ? 1 : 0;
    this.ldb.db.prepare(APPLY_ATTEMPT_SQL).run(questionId, streak, lastResult);
    const row = this.ldb.db
      .prepare('SELECT interval_days, next_review FROM review_schedule WHERE question_id = ?')
      .get(questionId) as { interval_days: number; next_review: string } | undefined;
    if (!row) {
      throw new Error(`review schedule for question ${questionId} is missing after applyAttempt`);
    }
    return { intervalDays: row.interval_days, nextReview: row.next_review };
  }

  get(questionId: string): Record<string, unknown> | undefined {
    return this.ldb.db
      .prepare('SELECT * FROM review_schedule WHERE question_id = ?')
      .get(questionId) as Record<string, unknown> | undefined;
  }

  dueQuestionIds(now = new Date()): string[] {
    const rows = this.ldb.db
      .prepare('SELECT question_id FROM review_schedule WHERE next_review <= ?')
      .all(now.toISOString()) as Array<{ question_id: string }>;
    return rows.map((r) => r.question_id);
  }
}
