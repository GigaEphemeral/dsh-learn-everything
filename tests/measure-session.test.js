// Unit tests for the session-cost measurement (S3, T4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { countLine, createCounter } from "../scripts/measure-session.mjs";

test("countLine tallies model and tool events with usage", () => {
  const state = createCounter();
  countLine({ type: "assistant/message", data: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 800 } } }, state);
  countLine({ type: "tool/call", data: { name: "bash" } }, state);
  countLine({ type: "tool/call", data: { name: "bash" } }, state);
  countLine({ type: "turn/start", data: {} }, state);
  assert.equal(state.modelCalls, 1);
  assert.equal(state.toolCalls, 2);
  assert.equal(state.toolNames.bash, 2);
  assert.equal(state.tokens.input, 100);
  assert.equal(state.tokens.output, 20);
  assert.equal(state.tokens.cacheRead, 800);
});

test("countLine falls back to short usage key names", () => {
  const state = createCounter();
  countLine({ type: "assistant/message", data: { usage: { input: 1, output: 2, cacheRead: 3 } } }, state);
  assert.equal(state.tokens.input, 1);
  assert.equal(state.tokens.output, 2);
  assert.equal(state.tokens.cacheRead, 3);
});


test("measureSession --by-turn resets counters at turn boundaries", async () => {
  const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "msr-"));
  const file = join(dir, "s.jsonl");
  const lines = [
    JSON.stringify({ type: "turn/start" }),
    JSON.stringify({ type: "assistant/message", data: { usage: { inputTokens: 10 } } }),
    JSON.stringify({ type: "tool/call", data: { name: "bash" } }),
    JSON.stringify({ type: "turn/start" }),
    JSON.stringify({ type: "assistant/message", data: { usage: { inputTokens: 20 } } }),
  ];
  await writeFile(file, lines.join("\n"));
  try {
    const { measureSession } = await import("../scripts/measure-session.mjs");
    const m = await measureSession(file, { byTurn: true });
    assert.equal(m.turns.length, 2);
    assert.equal(m.turns[0].modelCalls, 1);
    assert.equal(m.turns[0].tokens.input, 10);
    assert.equal(m.turns[1].modelCalls, 1);
    assert.equal(m.turns[1].tokens.input, 20);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
