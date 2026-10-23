// Unit tests for KarpathyDriver: snapshot diff and blocking wait.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INGEST_POLL_INTERVAL_MS,
  DEFAULT_INGEST_SETTLE_MS,
  DEFAULT_INGEST_TIMEOUT_MS,
  KarpathyDriver,
  WIKI_DIRS,
  WIKI_DIR_KEYS,
} from "../src/wiki/karpathy-driver.js";

function makeDriver({ listImpl, pollIntervalMs = 5, timeoutMs = 500, settleMs = 2 }) {
  const adapter = { list: async (dir) => ({ files: listImpl(dir) }) };
  const mcp = { tool: async () => "{\"message\":\"OK\"}" };
  return new KarpathyDriver({ adapter, mcp, pollIntervalMs, timeoutMs, settleMs });
}

function makeDriverWithOutput(output) {
  const adapter = { list: async () => ({ files: [] }) };
  const mcp = { tool: async () => output };
  return new KarpathyDriver({ adapter, mcp, pollIntervalMs: 5, timeoutMs: 100, settleMs: 2 });
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

test("wiki dir keys are an explicit and complete map (D4)", () => {
  assert.deepEqual(Object.keys(WIKI_DIR_KEYS), WIKI_DIRS);
  for (const dir of WIKI_DIRS) assert.equal(typeof WIKI_DIR_KEYS[dir], "string");
  const driver = makeDriver({ listImpl: () => [] });
  const created = driver._diff({}, {});
  assert.deepEqual(Object.keys(created), ["sources", "concepts", "entities"]);
  assert.ok(!Object.hasOwn(created, "undefined"));
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

test("waitForIngest caps the settle sleep by the remaining deadline (D1)", async () => {
  let calls = 0;
  const driver = makeDriver({
    pollIntervalMs: 5,
    timeoutMs: 120,
    settleMs: 5000,
    listImpl: () => {
      calls += 1;
      return calls === 1 ? [] : ["new-source.md"];
    },
  });
  const snapshot = await driver.snapshotWiki();
  const result = await driver.waitForIngest({ snapshot, pollIntervalMs: 5, timeoutMs: 120, settleMs: 5000 });
  assert.deepEqual(result.created.sources, ["new-source.md"]);
  // Without the cap the settle sleep alone would be 5000ms.
  assert.ok(result.elapsedMs < 1000, `settle sleep must be capped, elapsed ${result.elapsedMs}ms`);
});

test("constructor replaces non-positive/non-finite durations with defaults (D3)", () => {
  const adapter = { list: async () => ({ files: [] }) };
  const mcp = { tool: async () => "OK" };
  const driver = new KarpathyDriver({
    adapter,
    mcp,
    pollIntervalMs: 0,
    timeoutMs: -1,
    settleMs: Number.NaN,
  });
  assert.equal(driver.pollIntervalMs, DEFAULT_INGEST_POLL_INTERVAL_MS);
  assert.equal(driver.timeoutMs, DEFAULT_INGEST_TIMEOUT_MS);
  assert.equal(driver.settleMs, DEFAULT_INGEST_SETTLE_MS);
  const custom = new KarpathyDriver({ adapter, mcp, pollIntervalMs: 3, timeoutMs: 4, settleMs: 5 });
  assert.deepEqual([custom.pollIntervalMs, custom.timeoutMs, custom.settleMs], [3, 4, 5]);
});

test("openAndIngest accepts JSON message OK and plain trimmed OK (D2)", async () => {
  for (const output of ['{"message":"OK"}', "OK", "  OK\n", '{"jsonrpc":"2.0","message":"OK","ok":true}']) {
    await makeDriverWithOutput(output).openAndIngest("x.md");
  }
});

test("openAndIngest rejects outputs that merely contain OK (D2)", async () => {
  for (const output of ['{"message":"Not OK"}', "not OK", "OK but failed?", "error"]) {
    await assert.rejects(
      () => makeDriverWithOutput(output).openAndIngest("x.md"),
      /did not return OK/,
    );
  }
});

test("openAndIngest surfaces a non-OK command result", async () => {
  const adapter = { list: async () => ({ files: [] }) };
  const mcp = { tool: async () => "error" };
  const driver = new KarpathyDriver({ adapter, mcp, pollIntervalMs: 5, timeoutMs: 100 });
  await assert.rejects(() => driver.openAndIngest("x.md"), /did not return OK/);
});
