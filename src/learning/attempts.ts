// Append-only attempt records (S2). Every answer is persisted; history is
// never rewritten. Links to the exact question version that was answered.

import type { LearningDb } from '../db/client.js';

export interface NewAttempt {
  attemptId: string;
  questionId: string;
  questionVersion: number;
  result: string;
  score?: number | null;
  answerSummary?: string | null;
  // Defaults to "first" (the answer to a freshly generated question) when the
  // caller omits it (e.g. JSON payload without the optional field).
  phase?: string;
}

function requireNonEmptyString(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`attempt.record requires a non-empty ${field}`);
  }
  return value;
}

function requireQuestionVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('attempt.record requires a finite questionVersion');
  }
  return value;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class AttemptStore {
  constructor(private readonly ldb: LearningDb) {}

  record(a: NewAttempt): void {
    const attemptId = requireNonEmptyString('attemptId', a.attemptId);
    const questionId = requireNonEmptyString('questionId', a.questionId);
    const questionVersion = requireQuestionVersion(a.questionVersion);
    const result = requireNonEmptyString('result', a.result);
    // Optional fields are normalised to null so an omitted value never reaches
    // the binding layer as `undefined` (node:sqlite throws on undefined binds).
    const score = a.score === undefined ? null : a.score;
    const answerSummary = a.answerSummary === undefined ? null : a.answerSummary;
    const phase = a.phase === undefined ? 'first' : a.phase;
    try {
      this.ldb.db
        .prepare(
          'INSERT INTO attempts (attempt_id, question_id, question_version, answered_at, result, score, answer_summary, phase) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(attemptId, questionId, questionVersion, new Date().toISOString(), result, score, answerSummary, phase);
    } catch (err) {
      // Keep the raw constraint/IO cause but make the failure attributable.
      throw new Error(
        `failed to record attempt ${attemptId} for question ${questionId} (version ${questionVersion}): ${errorMessage(err)}`,
        { cause: err },
      );
    }
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
