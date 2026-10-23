// Practice persistence CLI (S2). The daily-practice skill calls this to record
// generated questions and answers into SQLite (decision B).
// Usage (from code/):
//   node scripts/practice-db.mjs question '<json>'
//   node scripts/practice-db.mjs answer '<json>'
//   node scripts/practice-db.mjs status <questionId>

import { LearningDb } from "../lib/src/db/client.js";
import { PracticeSession } from "../lib/src/learning/practice.js";
import { QuestionStore } from "../lib/src/learning/questions.js";
import { ReviewStore } from "../lib/src/learning/review.js";
import { MasteryStore } from "../lib/src/learning/mastery.js";
import { resolveStateDir } from "../src/ingest/state-dir.js";
import { join } from "node:path";

const dbPath = process.env.OBSIDIAN_LEARNING_DB ?? join(resolveStateDir(import.meta.url), "learning.db");
const ldb = new LearningDb(dbPath);
const cmd = process.argv[2];

try {
  if (cmd === "question") {
    const q = JSON.parse(process.argv[3]);
    new PracticeSession(ldb).startQuestion(q);
    console.log("question recorded:", q.questionId);
  } else if (cmd === "answer") {
    const a = JSON.parse(process.argv[3]);
    const id = new PracticeSession(ldb).recordAnswer(a);
    console.log("answer recorded:", id);
  } else if (cmd === "status") {
    const qid = process.argv[3];
    const q = new QuestionStore(ldb).get(qid);
    const r = new ReviewStore(ldb).get(qid);
    const atts = ldb.db.prepare('SELECT result, phase, score, answered_at FROM attempts WHERE question_id = ? ORDER BY id').all(qid);
    let mastery = [];
    if (q) {
      const concept = ldb.db.prepare('SELECT id FROM concepts WHERE name = ?').get(q.topic);
      if (concept) mastery = new MasteryStore(ldb).recentLevels(concept.id, 5);
    }
    console.log(JSON.stringify({ question: q ?? null, review: r ?? null, attempts: atts, mastery }, null, 2));
  } else {
    console.error("usage: practice-db.mjs <question|answer|status> <json|id>");
    process.exit(2);
  }
} finally {
  ldb.close();
}
