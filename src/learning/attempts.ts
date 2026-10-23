// Append-only attempt records (S2). Every answer is persisted; history is
// never rewritten. Links to the exact question version that was answered.

import type { LearningDb } from '../db/client.js';
import type { AttemptResult, PracticePhase } from './types.js';
import { ATTEMPT_RESULTS, PRACTICE_PHASES, isAttemptResult, isPracticePhase } from './types.js';
import { safeLimit } from './limits.js';

export interface NewAttempt {
  attemptId: string;
  questionId: string;
  questionVersion: number;
  result: AttemptResult;
  score?: number | null;
  answerSummary?: string | null;
  // Defaults to "first" (the answer to a freshly generated question) when the
  // caller omits it (e.g. JSON payload without the optional field).
  phase?: PracticePhase;
}

// Typed projection of an attempts row. The internal surrogate `id` (insert
// order) is intentionally not exposed; callers order by it instead.
export interface AttemptRow {
  attempt_id: string;
  question_id: string;
  question_version: number;
  answered_at: string;
  result: AttemptResult;
  score: number | null;
  answer_summary: string | null;
  phase: PracticePhase;
}

function requireNonEmptyString(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`attempt.record requires a non-empty ${field}`);
  }
  return value;
}

function requireResult(value: unknown): AttemptResult {
  // Keep the "non-empty" wording for a missing value (callers/regression tests
  // distinguish missing from out-of-domain).
  requireNonEmptyString('result', value);
  if (!isAttemptResult(value)) {
    throw new Error(`invalid attempt result "${String(value)}"; expected one of ${ATTEMPT_RESULTS.join('|')}`);
  }
  return value;
}

function requirePhase(value: unknown): PracticePhase {
  if (!isPracticePhase(value)) {
    throw new Error(`invalid practice phase "${String(value)}"; expected one of ${PRACTICE_PHASES.join('|')}`);
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
    const result = requireResult(a.result);
    // Optional fields are normalised to null so an omitted value never reaches
    // the binding layer as `undefined` (node:sqlite throws on undefined binds).
    const score = a.score === undefined ? null : a.score;
    const answerSummary = a.answerSummary === undefined ? null : a.answerSummary;
    const phase = a.phase === undefined ? 'first' : requirePhase(a.phase);
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

  recentFor(questionId: string, limit = 10): AttemptRow[] {
    return this.ldb.db
      .prepare('SELECT attempt_id, question_id, question_version, answered_at, result, score, answer_summary, phase FROM attempts WHERE question_id = ? ORDER BY id DESC LIMIT ?')
      .all(questionId, safeLimit(limit, 10)) as unknown as AttemptRow[];
  }

  count(): number {
    const row = this.ldb.db.prepare('SELECT COUNT(*) AS n FROM attempts').get() as { n: number };
    return row.n;
  }
}
