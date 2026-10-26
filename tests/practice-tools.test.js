// Native practice tools (environment fix): the host executes the SQLite writes,
// so WAL sidecar creation never hits the agent sandbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GRILL_SCORE_THRESHOLD, isGrillRequired, practiceToolSpecs, registerPracticeTools } from '../src/tools/practice-tools.js';
import { DEFAULT_GRILL_PERSONA } from '../index.js';

function fakeCtx() {
  const registered = [];
  return {
    registered,
    tools: { register: (tool) => { registered.push(tool); return () => {}; } },
  };
}

test("registers five practice tools when the host exposes tools", () => {
  const ctx = fakeCtx();
  const n = registerPracticeTools(ctx, { getConfig: () => ({ apiKey: 'k' }) });
  assert.equal(n.length, 5);
  assert.deepEqual(ctx.registered.map((t) => t.name),
    ['practice_draw_node', 'practice_record_question', 'practice_record_answer', 'practice_status',
      'practice_grill_gate']);
});

test("grill gate flags scores below 6 and returns the configured persona", async () => {
  const prev = process.env.OBSIDIAN_GRILL_PERSONA;
  delete process.env.OBSIDIAN_GRILL_PERSONA;
  try {
    // The threshold is part of the daily-practice contract: below 6 is
    // mandatory, 6 and above may end the practice.
    assert.equal(GRILL_SCORE_THRESHOLD, 6);
    assert.equal(isGrillRequired(0), true);
    assert.equal(isGrillRequired(5), true);
    assert.equal(isGrillRequired(6), false);
    assert.equal(isGrillRequired(10), false);

    const gate = practiceToolSpecs({ getConfig: () => ({ grillPersona: 'CUSTOM-PERSONA-X' }) })
      .find((tool) => tool.name === 'practice_grill_gate');
    assert.ok(gate, 'practice_grill_gate must be registered in the practice tool specs');
    assert.deepEqual(gate.parameters.required, ['score']);

    assert.deepEqual(await gate.execute({ score: 5 }), {
      score: 5, threshold: 6, required: true, skill: 'obs-grill-me', persona: 'CUSTOM-PERSONA-X',
    });
    const atThreshold = await gate.execute({ score: 6 });
    assert.equal(atThreshold.required, false);
    assert.equal(atThreshold.threshold, 6);
    assert.equal(atThreshold.skill, 'obs-grill-me');
    assert.equal((await gate.execute({ score: 0 })).required, true);
    assert.equal((await gate.execute({ score: 10 })).required, false);

    // Without a configured persona the gate returns the built-in teacher, so
    // the tool and the skill render the same text.
    const fallbackGate = practiceToolSpecs({ getConfig: () => ({}) })
      .find((tool) => tool.name === 'practice_grill_gate');
    const fallback = await fallbackGate.execute({ score: 4 });
    assert.equal(fallback.required, true);
    assert.equal(fallback.persona, DEFAULT_GRILL_PERSONA);

    await assert.rejects(() => gate.execute({}), /missing required argument "score"/);
    await assert.rejects(() => gate.execute({ score: 11 }), /invalid argument "score"/);
    await assert.rejects(() => gate.execute({ score: -1 }), /invalid argument "score"/);
  } finally {
    if (prev === undefined) delete process.env.OBSIDIAN_GRILL_PERSONA;
    else process.env.OBSIDIAN_GRILL_PERSONA = prev;
  }
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

// The gate and the obs-grill-me skill share one persona resolver. Importing the
// bundle entry from this module would create an ESM cycle (the entry registers
// this tool group), so the resolver must live in its own module.
test("practice tools resolve the grill persona from the shared module, not the entry", async () => {
  const source = await readFile(new URL('../src/tools/practice-tools.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"]\.\.\/\.\.\/index\.js['"]/, 'importing the entry back creates an ESM cycle');
  assert.match(source, /from ['"]\.\.\/persona\.js['"]/, 'the persona resolver is shared with the skill provider');
});
