// Native practice tools (environment fix): the host executes the SQLite writes,
// so WAL sidecar creation never hits the agent sandbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { practiceToolSpecs, registerPracticeTools } from '../src/tools/practice-tools.js';

function fakeCtx() {
  const registered = [];
  return {
    registered,
    tools: { register: (tool) => { registered.push(tool); return () => {}; } },
  };
}

test("registers four practice tools when the host exposes tools", () => {
  const ctx = fakeCtx();
  const n = registerPracticeTools(ctx, { getConfig: () => ({ apiKey: 'k' }) });
  assert.equal(n.length, 4);
  assert.deepEqual(ctx.registered.map((t) => t.name),
    ['practice_draw_node', 'practice_record_question', 'practice_record_answer', 'practice_status']);
});

test("skips registration when the host has no tools service", () => {
  assert.equal(registerPracticeTools({}, {}).length, 0);
});

test("record question/answer/status execute host-side against a temp DB", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-learn-tools-'));
  process.env.OBSIDIAN_LEARNING_DB = join(dir, 'learning.db');
  try {
    const ctx = fakeCtx();
    registerPracticeTools(ctx, { getConfig: () => ({}) });
    const byName = Object.fromEntries(ctx.registered.map((t) => [t.name, t]));
    const q = await byName.practice_record_question.execute(
      { questionId: 'q1', version: 1, type: 'concept', topic: 'SQLite', prompt: 'What is WAL?', reference: null });
    assert.equal(q.recorded, true);
    assert.equal(q.questionId, 'q1');
    const a = await byName.practice_record_answer.execute(
      { questionId: 'q1', questionVersion: 1, result: 'correct', correct: true, score: 90, phase: 'first', concepts: ['SQLite'], feedback: 'ok' });
    assert.ok(a.answerId);
    const s = await byName.practice_status.execute({ questionId: 'q1' });
    assert.equal(s.question.question_id, 'q1');
    assert.equal(s.attempts.length, 1);
    assert.ok(Array.isArray(s.mastery));
  } finally {
    delete process.env.OBSIDIAN_LEARNING_DB;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("practice tools are registry-ready and reject incomplete calls", async () => {
  const ctx = fakeCtx();
  registerPracticeTools(ctx, { getConfig: () => ({}) });
  for (const tool of ctx.registered) {
    assert.equal(typeof tool.output.render, "function", `${tool.name} must render`);
    assert.equal(tool.parameters.type, "object", `${tool.name} must expose a JSON-Schema object`);
    assert.deepEqual(tool.output.render({}, { ok: true }), [{ type: "text", text: '{"ok":true}' }]);
  }
  const record = ctx.registered.find((tool) => tool.name === "practice_record_question");
  await assert.rejects(() => record.execute({ questionId: "q1" }), /missing required argument "version"/);
  const answer = ctx.registered.find((tool) => tool.name === "practice_record_answer");
  await assert.rejects(
    () => answer.execute({ questionId: "q1", questionVersion: 1, result: "correct", correct: true, phase: "bogus" }),
    /invalid argument "phase"/);
});

test("draw tool refuses without an API key (no network attempted)", async () => {
  const ctx = fakeCtx();
  registerPracticeTools(ctx, { getConfig: () => ({ apiKey: '' }) });
  const draw = ctx.registered.find((t) => t.name === 'practice_draw_node');
  const out = await draw.execute({});
  assert.equal(out.error, 'obsidian-not-configured');
});
