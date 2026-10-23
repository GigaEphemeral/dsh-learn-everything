// Question records (S2): generated questions are persisted (with version) so
// attempts link to the exact version answered. Questions are generated on
// demand, NOT maintained as a static question bank.

import type { LearningDb } from '../db/client.js';

export interface NewQuestion {
  questionId: string;
  version: number;
  type: string;
  topic: string;
  prompt: string;
  reference: string | null;
}

export class QuestionStore {
  constructor(private readonly ldb: LearningDb) {}

  create(q: NewQuestion): void {
    this.ldb.db
      .prepare('INSERT INTO questions (question_id, version, type, topic, prompt, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(q.questionId, q.version, q.type, q.topic, q.prompt, q.reference, new Date().toISOString());
  }

  get(questionId: string): Record<string, unknown> | undefined {
    return this.ldb.db.prepare('SELECT * FROM questions WHERE question_id = ?').get(questionId) as Record<string, unknown> | undefined;
  }
}
