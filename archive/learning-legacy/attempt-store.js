// Attempt store (P5): append-only answer records in a JSONL state file.
// Never rewrites history; each attempt links to its question id.

import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

export class AttemptStore {
  constructor({ filePath }) {
    if (!filePath) throw new Error("AttemptStore: filePath is required");
    this.filePath = filePath;
  }

  // Append one attempt record (JSONL). Returns the record.
  async record({ questionId, questionVersion = "v1", result, score, note = "" }) {
    const attempt = {
      attemptId: `attempt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      questionId,
      questionVersion,
      answeredAt: new Date().toISOString(),
      result,
      score,
      note,
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, JSON.stringify(attempt) + "\n", { flag: "a" });
    return attempt;
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  // Recent attempts for a question, newest first.
  async recentFor(questionId, { limit = 10 } = {}) {
    const all = await this.load();
    return all.filter((a) => a.questionId === questionId).slice(-limit).reverse();
  }
}
