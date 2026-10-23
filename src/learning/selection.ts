// Practice selection (S2, task 4). Weighted priority: overdue > weakness
// (from recent attempt history, not just last result) > coverage > novelty.
// Weights are env-configurable (OBSIDIAN_REVIEW_W_*).

import type { LearningDb } from '../db/client.js';

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export interface SelectionWeights {
  overdue: number;
  weakness: number;
  coverage: number;
  novelty: number;
}

export const DEFAULT_SELECTION_WEIGHTS: SelectionWeights = {
  overdue: envNumber('OBSIDIAN_REVIEW_W_OVERDUE', 1.0),
  weakness: envNumber('OBSIDIAN_REVIEW_W_WEAKNESS', 0.8),
  coverage: envNumber('OBSIDIAN_REVIEW_W_COVERAGE', 0.5),
  novelty: envNumber('OBSIDIAN_REVIEW_W_NOVELTY', 0.3),
};

export interface Candidate {
  questionId: string;
  topicCount: number;
  attemptedCount: number;
}

export class PracticeSelector {
  constructor(
    private readonly ldb: LearningDb,
    private readonly weights: SelectionWeights = DEFAULT_SELECTION_WEIGHTS,
  ) {}

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
    const overdue = cur && new Date(cur.next_review) <= now ? 1 : 0;
    const weakness = this.weakness(questionId);
    const coverage = topicCount > 1 ? attemptedCount / topicCount : 0;
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
