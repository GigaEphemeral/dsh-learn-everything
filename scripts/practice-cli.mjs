// Practice CLI (P5 /每日一练): pick due questions, ask, self-grade, record.
// Usage: OBSIDIAN_API_KEY=... node scripts/practice-cli.mjs [count]

import { ObsidianClient, ObsidianAdapter } from "../src/obsidian/obsidian-adapter.js";
import { ReviewScheduler } from "../src/learning/review-scheduler.js";
import { AttemptStore } from "../src/learning/attempt-store.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const apiKey = process.env.OBSIDIAN_API_KEY;
const count = Number(process.argv[2] ?? 3);
const stateDir = process.env.OBSIDIAN_STATE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".state");
if (!apiKey) {
  console.error("usage: OBSIDIAN_API_KEY=... node scripts/practice-cli.mjs [count]");
  process.exit(1);
}

// Load the question bank: Learning/Questions/*.md (via adapter.list + read).
async function loadQuestions(adapter) {
  let files;
  try {
    ({ files } = await adapter.list("Learning/Questions"));
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
  const questions = [];
  for (const f of files ?? []) {
    const content = await adapter.read(`Learning/Questions/${f}`);
    const idMatch = content.match(/question_id: "?([^\s\"\n]+)"?/);
    const topicMatch = content.match(/^# 题目：(.+)$/m);
    if (idMatch && topicMatch) {
      questions.push({ id: idMatch[1], topic: topicMatch[1].trim(), path: `Learning/Questions/${f}`, content });
    }
  }
  return questions;
}

const client = new ObsidianClient({ baseUrl: "https://127.0.0.1:27124", apiKey });
const adapter = new ObsidianAdapter(client);
const attempts = new AttemptStore({ filePath: join(stateDir, "attempts.jsonl") });
const scheduler = new ReviewScheduler();
const reviewFile = join(stateDir, "review.json");
try {
  scheduler.load(JSON.parse(await readFile(reviewFile, "utf8")));
} catch {
  scheduler.load({});
}

const questions = await loadQuestions(adapter);
console.log("question bank:", questions.length, "questions");
if (questions.length === 0) {
  console.log("no questions yet; create one with scripts/create-question-cli.mjs");
  rl.close();
process.exit(0);
}

// Score every question and pick the top N.
const attemptsByQuestion = {};
for (const q of questions) {
  attemptsByQuestion[q.id] = (await attempts.recentFor(q.id)).length;
}
const ranked = questions
  .map((q) => ({ q, score: scheduler.score(q.id, { attemptedCount: attemptsByQuestion[q.id] ?? 0, topicCount: questions.length }) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, count);

// Line queue: works with both interactive terminals and piped input,
// which readline's rl.question races on (a piped second line can be lost).
const rl = createInterface({ input: process.stdin, output: process.stdout });
const inputLines = [];
let inputClosed = false;
rl.on("line", (l) => inputLines.push(l));
rl.on("close", () => { inputClosed = true; });
function ask(prompt) {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    const wait = () => {
      if (inputLines.length > 0) return resolve(inputLines.shift().trim());
      if (inputClosed) return resolve("");
      setTimeout(wait, 50);
    };
    wait();
  });
}

for (const { q, score } of ranked) {
  console.log(`\n===== 题目 (score ${score.toFixed(2)}) ${q.topic} =====`);
  const body = q.content.split("## 题干")[1]?.split("## 参考答案")[0] ?? q.content;
  console.log("题干:\n" + body.trim());
  await ask("\n输入你的答案（回车跳过直接看答案）: ");
  const ref = q.content.split("## 参考答案")[1]?.split("## 评分标准")[0] ?? "";
  console.log("\n参考答案:\n" + ref.trim());
  const grade = (await ask("\n自我评分 1-5（1=不会，5=熟练）: ")).trim();
  const scoreNum = Number(grade);
  const correct = Number.isFinite(scoreNum) && scoreNum >= 3;
  const attempt = await attempts.record({ questionId: q.id, result: correct ? "correct" : "incorrect", score: scoreNum, note: `self ${grade}` });
  scheduler.applyAttempt(q.id, { correct });
  console.log("recorded:", attempt.attemptId, correct ? "correct" : "incorrect");
}

await mkdir(dirname(reviewFile), { recursive: true });
await writeFile(reviewFile, JSON.stringify(scheduler.review, null, 2));
console.log("\nreview state saved:", reviewFile);
process.exit(0);
