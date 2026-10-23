// Compact learning-state summary for a knowledge node (S3, T2).

import type { LearningDb } from '../db/client.js';
import { QuestionStore } from './questions.js';
import { MasteryStore, type MasteryEvidence } from './mastery.js';

export interface LearningSummary {
  questions: Array<{ questionId: string; version: number; type: string }>;
  attempts: { total: number; byResult: Record<string, number> };
  review: Record<string, unknown> | null;
  mastery: MasteryEvidence[];
}

export function learningSummaryFor(ldb: LearningDb, topic: string): LearningSummary {
  const questions = new QuestionStore(ldb).byTopic(topic);
  const ids = questions.map((x) => x.questionId);
  const byResult: Record<string, number> = {};
  let total = 0;
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = ldb.db
      .prepare("SELECT result, COUNT(*) AS n FROM attempts WHERE question_id IN (" + placeholders + ") GROUP BY result")
      .all(...ids) as Array<{ result: string; n: number }>;
    for (const r of rows) {
      byResult[r.result] = r.n;
      total += r.n;
    }
  }
  const concept = ldb.db.prepare("SELECT id FROM concepts WHERE name = ?").get(topic) as { id: number } | undefined;
  const mastery = concept ? new MasteryStore(ldb).recentLevels(concept.id, 3) : [];
  const firstId = ids[0];
  const review = firstId ? (ldb.db.prepare("SELECT * FROM review_schedule WHERE question_id = ?").get(firstId) as Record<string, unknown>) : null;
  return { questions, attempts: { total, byResult }, review, mastery };
}
