// Concept mastery tracking (S2, task 3). A concept maps to a knowledge node
// (usually a wiki page). Mastery history records each evidence source
// separately (first answer / model rating / correction / variant pass) so a
// single LLM "understood" claim never proves mastery by itself.

import type { LearningDb } from '../db/client.js';

export class MasteryStore {
  constructor(private readonly ldb: LearningDb) {}

  ensureConcept(name: string, wikiPath: string | null): number {
    const existing = this.ldb.db.prepare("SELECT id FROM concepts WHERE name = ?").get(name) as { id: number } | undefined;
    if (existing) return existing.id;
    this.ldb.db
      .prepare('INSERT INTO concepts (name, wiki_path, created_at) VALUES (?, ?, ?)')
      .run(name, wikiPath, new Date().toISOString());
    return (this.ldb.db.prepare("SELECT id FROM concepts WHERE name = ?").get(name) as { id: number }).id;
  }

  // Record an evidence point; level 0..1. source ∈ first_answer|model_rating|correction|variant_pass.
  recordLevel(conceptId: number, level: number, source: string): void {
    this.ldb.db
      .prepare('INSERT INTO mastery_history (concept_id, level, source, recorded_at) VALUES (?, ?, ?, ?)')
      .run(conceptId, level, source, new Date().toISOString());
  }

  recentLevels(conceptId: number, limit = 5): Array<Record<string, unknown>> {
    return this.ldb.db.prepare('SELECT level, source, recorded_at FROM mastery_history WHERE concept_id = ? ORDER BY id DESC LIMIT ?').all(conceptId, limit) as Array<Record<string, unknown>>;
  }
}
