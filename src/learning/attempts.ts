// Append-only attempt records (S2). Every answer is persisted; history is
// never rewritten. Links to the question version it was answered against.

import type { LearningDb } from '../db/client.js';

export interface NewAttempt {
  attemptId: string;
  questionId: string;
  questionVersion: number;
  result: string;
  score: number | null;
  answerSummary: string | null;
  phase: string;
}

export class AttemptStore {
  constructor(private readonly ldb: LearningDb) {}

  record(a: NewAttempt): void {
    this.ldb.db
      .prepare(
        'INSERT INTO attempts (attempt_id, question_id, question_version, answered_at, result, score, answer_summary, phase) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(a.attemptId, a.questionId, a.questionVersion, new Date().toISOString(), a.result, a.score, a.answerSummary, a.phase);
  }

  recentFor(questionId: string, limit = 10): Array<Record<string, unknown>> {
    return this.ldb.db
      .prepare('SELECT * FROM attempts WHERE question_id = ? ORDER BY id DESC LIMIT ?')
      .all(questionId, limit) as Array<Record<string, unknown>>;
  }

  count(): number {
    const row = this.ldb.db.prepare('SELECT COUNT(*) AS n FROM attempts').get() as { n: number };
    return row.n;
  }
}
