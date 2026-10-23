// Practice selection (S2, task 4). Weighted priority: overdue > weakness
// (from recent attempt history, not just last result) > coverage > novelty.
// Weights are env-configurable (OBSIDIAN_REVIEW_W_*).

import type { LearningDb } from '../db/client.js';

export interface SelectionWeights {
  overdue: number;
  weakness: number;
  coverage: number;
  novelty: number;
}

// Defaults are literals. Environment overrides are resolved when a selector is
// constructed (A41), not once at module load, so tests and long-lived processes
// always see the current environment.
export const DEFAULT_SELECTION_WEIGHTS: SelectionWeights = {
  overdue: 1.0,
  weakness: 0.8,
  coverage: 0.5,
  novelty: 0.3,
};

const WEIGHT_KEYS = ['overdue', 'weakness', 'coverage', 'novelty'] as const;

const WEIGHT_ENV: Record<keyof SelectionWeights, string> = {
  overdue: 'OBSIDIAN_REVIEW_W_OVERDUE',
  weakness: 'OBSIDIAN_REVIEW_W_WEAKNESS',
  coverage: 'OBSIDIAN_REVIEW_W_COVERAGE',
  novelty: 'OBSIDIAN_REVIEW_W_NOVELTY',
};

function validateWeight(label: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number, got ${String(value)}`);
  }
  if (value < 0) {
    throw new Error(`${label} must be non-negative, got ${value}`);
  }
  return value;
}

// Merge explicit overrides over env values over defaults (A40/A41), rejecting
// invalid numbers instead of letting NaN silently poison every ranking.
function resolveWeights(overrides: Partial<SelectionWeights>): SelectionWeights {
  const resolved: SelectionWeights = { ...DEFAULT_SELECTION_WEIGHTS };
  for (const key of WEIGHT_KEYS) {
    const envName = WEIGHT_ENV[key];
    const raw = process.env[envName];
    let value: number = resolved[key];
    if (raw !== undefined && raw.trim() !== '') {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        throw new Error(`invalid ${envName}="${raw}": expected a finite number`);
      }
      value = parsed;
    }
    const override = overrides[key];
    if (override !== undefined) value = override;
    resolved[key] = validateWeight(`selection weight "${key}"`, value);
  }
  return resolved;
}

export interface Candidate {
  questionId: string;
  topicCount: number;
  attemptedCount: number;
}

export class PracticeSelector {
  private readonly weights: SelectionWeights;

  constructor(
    private readonly ldb: LearningDb,
    weights: Partial<SelectionWeights> = {},
  ) {
    this.weights = resolveWeights(weights);
  }

  // Weakness 0..1: share of incorrect results in the last `window` attempts.
  private weakness(questionId: string, window = 3): number {
    const rows = this.ldb.db.prepare('SELECT result FROM attempts WHERE question_id = ? ORDER BY id DESC LIMIT ?').all(questionId, window) as Array<{ result: string }>;
    if (rows.length === 0) return 0;
    const incorrect = rows.filter((r) => r.result === "incorrect").length;
    return incorrect / rows.length;
  }

  score(questionId: string, opts: { attemptedCount?: number; topicCount?: number; now?: Date } = {}): number {
    const { attemptedCount = 0, topicCount = 1, now = new Date() } = opts;
    const cur = this.ldb.db
      .prepare('SELECT next_review, last_result FROM review_schedule WHERE question_id = ?')
      .get(questionId) as { next_review: string; last_result: string | null } | undefined;
    // A39: parse explicitly and only trust finite timestamps, so a corrupt
    // next_review can never leak NaN/Invalid Date semantics into the ranking.
    const nextReviewMs = cur ? Date.parse(cur.next_review) : Number.NaN;
    const nowMs = now.getTime();
    const overdue = (Number.isFinite(nextReviewMs) && Number.isFinite(nowMs) && nextReviewMs <= nowMs) ? 1 : 0;
    const weakness = this.weakness(questionId);
    // A38: coverage is a 0..1 share; clamp (and guard non-numeric inputs) so it
    // can never dominate the weighted sum with a value > 1 or < 0.
    const coverageRaw = topicCount > 1 ? attemptedCount / topicCount : 0;
    const coverage = Number.isFinite(coverageRaw) ? Math.min(1, Math.max(0, coverageRaw)) : 0;
    const novelty = cur ? 0 : 1;
    return (
      this.weights.overdue * overdue +
      this.weights.weakness * weakness +
      this.weights.coverage * coverage +
      this.weights.novelty * novelty
    );
  }

  // Rank candidates by score, highest first (due/weak/new first).
  selectCandidates(candidates: Candidate[], limit = 5, now = new Date()): Candidate[] {
    return candidates
      .map((c) => ({ ...c, score: this.score(c.questionId, { attemptedCount: c.attemptedCount, topicCount: c.topicCount, now }) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
