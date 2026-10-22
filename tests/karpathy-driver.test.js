// Unit tests for KarpathyDriver: snapshot diff and blocking wait.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KarpathyDriver } from "../src/wiki/karpathy-driver.js";

function makeDriver({ listImpl, pollIntervalMs = 5, timeoutMs = 500 }) {
  const adapter = { list: async (dir) => ({ files: listImpl(dir) }) };
  const mcp = { tool: async () => "{\"message\":\"OK\"}" };
  return new KarpathyDriver({ adapter, mcp, pollIntervalMs, timeoutMs });
}

test("diff reports created pages per directory", () => {
  const driver = makeDriver({ listImpl: () => [] });
  const before = {
    "wiki/sources": new Set(["a.md"]),
    "wiki/concepts": new Set(["x.md"]),
    "wiki/entities": new Set(),
  };
  const after = {
    "wiki/sources": new Set(["a.md", "b.md"]),
    "wiki/concepts": new Set(["x.md", "y.md"]),
    "wiki/entities": new Set(["e.md"]),
  };
  const created = driver._diff(before, after);
  assert.deepEqual(created, { sources: ["b.md"], concepts: ["y.md"], entities: ["e.md"] });
});

test("waitForIngest returns as soon as pages appear", async () => {
  // First list call returns nothing; after that, pages appear.
  let calls = 0;
  const driver = makeDriver({
    pollIntervalMs: 5,
    timeoutMs: 5000,
    listImpl: () => {
      calls += 1;
      return calls === 1 ? [] : ["new-source.md"];
    },
  });
  const snapshot = await driver.snapshotWiki();
  const result = await driver.waitForIngest({ snapshot, pollIntervalMs: 5 });
  assert.deepEqual(result.created.sources, ["new-source.md"]);
  assert.ok(result.elapsedMs >= 0);
});

test("waitForIngest throws on timeout with no pages", async () => {
  const driver = makeDriver({ listImpl: () => [], pollIntervalMs: 5, timeoutMs: 50 });
  const snapshot = await driver.snapshotWiki();
  await assert.rejects(
    () => driver.waitForIngest({ snapshot, timeoutMs: 50, pollIntervalMs: 5 }),
    /no wiki pages within 50ms/,
  );
});

test("openAndIngest surfaces a non-OK command result", async () => {
  const adapter = { list: async () => ({ files: [] }) };
  const mcp = { tool: async () => "error" };
  const driver = new KarpathyDriver({ adapter, mcp, pollIntervalMs: 5, timeoutMs: 100 });
  await assert.rejects(() => driver.openAndIngest("x.md"), /did not return OK/);
});
