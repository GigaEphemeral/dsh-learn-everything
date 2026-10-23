// LLM rating records (S2, A19). One rating row per rated answer; the practice
// orchestrator writes it inside the same transaction as the attempt, so a
// rating can never survive without its attempt (or the other way around).

import type { LearningDb } from '../db/client.js';

export interface NewRating {
  attemptId: string;
  modelRating?: number | null;
  feedback?: string | null;
  errorAnalysis?: string | null;
  suggestions?: string | null;
}

export interface RatingRow {
  attempt_id: string;
  model_rating: number | null;
  feedback: string | null;
  error_analysis: string | null;
  suggestions: string | null;
  rated_at: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class RatingStore {
  constructor(private readonly ldb: LearningDb) {}

  // Write one rating row. Optional fields are normalised undefined -> null so
  // node:sqlite never receives an undefined binding (empty strings are kept:
  // they are provided values, not missing ones).
  record(r: NewRating): void {
    if (typeof r.attemptId !== 'string' || r.attemptId.trim() === '') {
      throw new Error('rating.record requires a non-empty attemptId');
    }
    const modelRating = r.modelRating === undefined ? null : r.modelRating;
    const feedback = r.feedback === undefined ? null : r.feedback;
    const errorAnalysis = r.errorAnalysis === undefined ? null : r.errorAnalysis;
    const suggestions = r.suggestions === undefined ? null : r.suggestions;
    try {
      this.ldb.db
        .prepare('INSERT INTO ratings (attempt_id, model_rating, feedback, error_analysis, suggestions, rated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(r.attemptId, modelRating, feedback, errorAnalysis, suggestions, new Date().toISOString());
    } catch (err) {
      throw new Error(`failed to record rating for attempt ${r.attemptId}: ${errorMessage(err)}`, { cause: err });
    }
  }

  forAttempt(attemptId: string): RatingRow | undefined {
    return this.ldb.db
      .prepare('SELECT attempt_id, model_rating, feedback, error_analysis, suggestions, rated_at FROM ratings WHERE attempt_id = ?')
      .get(attemptId) as RatingRow | undefined;
  }
}
