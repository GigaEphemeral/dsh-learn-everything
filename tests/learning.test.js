// Unit tests for the learning domain (P5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuestionMarkdown, questionPath } from "../archive/learning-legacy/question-store.js";
import { ReviewScheduler } from "../archive/learning-legacy/review-scheduler.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttemptStore } from "../archive/learning-legacy/attempt-store.js";

test("buildQuestionMarkdown carries the plan frontmatter contract", () => {
  const md = buildQuestionMarkdown({
    questionId: "q_1", type: "concept", topic: "间隔重复", sourceNotes: ["[[间隔重复]]"],
    prompt: "解释间隔重复", reference: "间隔重复是…", rubric: ["是否说明复习间隔"], related: ["间隔重复"],
  });
  assert.ok(md.includes("question_id: \"q_1\""));
  assert.ok(md.includes("type: \"concept\""));
  assert.ok(md.includes("## 题干"));
  assert.ok(md.includes("## 参考答案"));
  assert.ok(md.includes("- [[间隔重复]]"));
});

test("questionPath slugs the topic", () => {
  assert.equal(questionPath("间隔重复"), "Learning/Questions/间隔重复.md");
  assert.equal(questionPath("HNSW Index"), "Learning/Questions/hnsw-index.md");
});

test("scheduler doubles interval on success and resets on failure", () => {
  const s = new ReviewScheduler();
  s.applyAttempt("q1", { correct: true });
  assert.equal(s.review["q1"].intervalDays, 2);
  s.applyAttempt("q1", { correct: true });
  assert.equal(s.review["q1"].intervalDays, 4);
  s.applyAttempt("q1", { correct: false });
  assert.equal(s.review["q1"].intervalDays, 1);
  assert.equal(s.review["q1"].correctStreak, 0);
});

test("scheduler priority favors overdue and novelty", () => {
  const s = new ReviewScheduler();
  const overdue = { q1: { nextReview: "2020-01-01T00:00:00Z", intervalDays: 2, correctStreak: 1, lastResult: "correct" } };
  s.load(overdue);
  const fresh = s.score("q2");
  const due = s.score("q1");
  assert.ok(due > fresh, "overdue question scores higher than a fresh one");
});

test("attempt store appends and never rewrites history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-att-"));
  const store = new AttemptStore({ filePath: join(dir, "attempts.jsonl") });
  await store.record({ questionId: "q1", result: "incorrect", score: 0.4 });
  await store.record({ questionId: "q1", result: "correct", score: 1 });
  const recent = await store.recentFor("q1");
  assert.equal(recent.length, 2);
  assert.equal(recent[0].result, "correct");
  await rm(dir, { recursive: true, force: true });
});
