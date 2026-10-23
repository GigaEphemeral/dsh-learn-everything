// Review scheduler (P5): spaced-repetition style state per question plus a
// weighted priority for daily practice. Weights come from env so they can be
// tuned per user: OBSIDIAN_REVIEW_W_OVERDUE/WEAKNESS/COVERAGE/NOVELTY.

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const DAY = 24 * 60 * 60 * 1000;

export class ReviewScheduler {
  constructor({ weights = {} } = {}) {
    this.weights = {
      overdue: envNumber("OBSIDIAN_REVIEW_W_OVERDUE", 1.0),
      weakness: envNumber("OBSIDIAN_REVIEW_W_WEAKNESS", 0.8),
      coverage: envNumber("OBSIDIAN_REVIEW_W_COVERAGE", 0.5),
      novelty: envNumber("OBSIDIAN_REVIEW_W_NOVELTY", 0.3),
      ...weights,
    };
    this.review = {}; // questionId -> { intervalDays, nextReview, correctStreak, lastResult }
  }

  load(records) {
    this.review = records ?? {};
    return this;
  }

  // Update review state after an attempt (simple interval doubling).
  applyAttempt(questionId, { correct }) {
    const cur = this.review[questionId] ?? { intervalDays: 1, correctStreak: 0 };
    if (correct) {
      cur.correctStreak += 1;
      cur.intervalDays = Math.min(Math.max(1, cur.intervalDays * 2), 30);
      cur.lastResult = "correct";
    } else {
      cur.correctStreak = 0;
      cur.intervalDays = 1;
      cur.lastResult = "incorrect";
    }
    cur.nextReview = new Date(Date.now() + cur.intervalDays * DAY).toISOString();
    this.review[questionId] = cur;
    return cur;
  }

  // Weighted priority for daily selection: overdue > weakness > coverage > novelty.
  score(questionId, { attemptedCount = 0, topicCount = 1 } = {}) {
    const cur = this.review[questionId];
    const overdue = cur && new Date(cur.nextReview) <= new Date() ? 1 : 0;
    const weakness = cur && cur.lastResult === "incorrect" ? 1 : 0;
    const coverage = topicCount > 1 ? (attemptedCount / topicCount) : 0;
    const novelty = cur ? 0 : 1;
    return (
      this.weights.overdue * overdue +
      this.weights.weakness * weakness +
      this.weights.coverage * coverage +
      this.weights.novelty * novelty
    );
  }
}
