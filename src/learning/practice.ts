// Practice session orchestrator (S2, task 3). Records a generated question,
// then every answer with its LLM rating, error analysis, and review-schedule
// update. Phases: first / correction / variant. All state goes to SQLite
// (decision B); nothing is written to Obsidian.

import { randomUUID } from 'node:crypto';
import type { LearningDb } from '../db/client.js';
import type { NewQuestion } from './questions.js';
import { QuestionStore } from './questions.js';
import { AttemptStore } from './attempts.js';
import { RatingStore } from './ratings.js';
import { ReviewStore } from './review.js';
import { MasteryStore } from './mastery.js';
import type { AttemptResult, PracticePhase } from './types.js';

// Re-exported for compatibility (this module was the original home of
// PracticePhase); the unions themselves live in the leaf types module.
export type { AttemptResult, PracticePhase } from './types.js';

// One concept whose mastery evidence this answer contributes.
export interface AnswerConcept {
  name: string;
  wikiPath: string | null;
  level: number;
  source: string;
}

export interface AnswerInput {
  questionId: string;
  questionVersion: number;
  // Omitted phase is stored as "first" by AttemptStore.
  phase?: PracticePhase;
  // Derived from `result`; when provided it must agree with it (A18).
  correct?: boolean;
  result: AttemptResult;
  score: number | null;
  answerSummary: string | null;
  modelRating?: number | null;
  feedback?: string | null;
  errorAnalysis?: string | null;
  suggestions?: string | null;
  // Omitted/empty concept list is valid (A17); nameless entries are skipped.
  concepts?: AnswerConcept[];
}

// Append-only attempt identity must be collision-safe even for answers recorded
// in the same millisecond (A45): a UUIDv4 is used instead of
// Date.now()+Math.random(), which could collide and corrupt attribution.
function newAttemptId(): string {
  return `attempt_${randomUUID()}`;
}

// SQLITE_CONSTRAINT_UNIQUE; a duplicate (question_id, version) is the only
// error startQuestion may swallow. Everything else (missing table, disk full,
// binding error, NOT NULL ...) must reach the caller.
function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const errcode = (err as { errcode?: number }).errcode;
  return errcode === 2067 || /UNIQUE constraint failed/i.test(err.message);
}

export class PracticeSession {
  private readonly questions: QuestionStore;
  private readonly attempts: AttemptStore;
  private readonly ratings: RatingStore;
  private readonly review: ReviewStore;
  private readonly mastery: MasteryStore;

  constructor(private readonly ldb: LearningDb) {
    this.questions = new QuestionStore(ldb);
    this.attempts = new AttemptStore(ldb);
    this.ratings = new RatingStore(ldb);
    this.review = new ReviewStore(ldb);
    this.mastery = new MasteryStore(ldb);
  }

  // Persist a freshly generated question (on-demand; version for traceability).
  // Re-generating the same (question_id, version) keeps the stored record; a
  // regenerated higher version is a new row (schema v2 composite uniqueness).
  startQuestion(q: NewQuestion): void {
    try {
      this.questions.create(q);
    } catch (err) {
      if (isUniqueConstraintError(err)) return;
      throw err;
    }
  }

  // Persist one answer + its LLM rating + review + mastery evidence atomically:
  // if any store fails, the whole answer is rolled back instead of leaving an
  // attempt without rating/review/mastery (or the other way around).
  recordAnswer(a: AnswerInput): string {
    // A18: `result` is the single source of truth for correctness; a caller that
    // passes a contradictory explicit `correct` gets a clear error instead of
    // writing two states that disagree.
    const derivedCorrect = a.result === 'correct';
    if (a.correct !== undefined && a.correct !== derivedCorrect) {
      throw new Error(
        `contradictory answer: result="${a.result}" implies correct=${derivedCorrect} but correct=${a.correct} was provided`,
      );
    }
    const attemptId = newAttemptId();
    // Normalise omitted optional fields to null so node:sqlite never receives
    // an undefined binding and "field empty" is distinguishable from "missing".
    const modelRating = a.modelRating === undefined ? null : a.modelRating;
    const feedback = a.feedback === undefined ? null : a.feedback;
    const errorAnalysis = a.errorAnalysis === undefined ? null : a.errorAnalysis;
    const suggestions = a.suggestions === undefined ? null : a.suggestions;
    // A17: a missing concept list means "no concepts", and malformed entries are
    // skipped rather than aborting the answer mid-write.
    const concepts = Array.isArray(a.concepts) ? a.concepts : [];
    this.ldb.transaction(() => {
      this.attempts.record({
        attemptId,
        questionId: a.questionId,
        questionVersion: a.questionVersion,
        result: a.result,
        score: a.score,
        answerSummary: a.answerSummary,
        phase: a.phase,
      });
      // `!== null` rather than truthiness: an empty-string feedback still means
      // a rating row was provided by the model.
      if (modelRating !== null || feedback !== null || errorAnalysis !== null || suggestions !== null) {
        this.ratings.record({ attemptId, modelRating, feedback, errorAnalysis, suggestions });
      }
      this.review.applyAttempt(a.questionId, derivedCorrect);
      for (const c of concepts) {
        if (!c || typeof c.name !== 'string' || c.name.trim() === '') continue;
        const wikiPath = typeof c.wikiPath === 'string' ? c.wikiPath : null;
        const id = this.mastery.ensureConcept(c.name, wikiPath);
        this.mastery.recordLevel(id, c.level, c.source);
      }
    });
    return attemptId;
  }
}
