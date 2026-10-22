// Unit tests for the ingest preflight.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreflight } from "../src/ingest/preflight.js";

function reg(records) {
  return { findByHash: (h) => records.find((r) => r.contentHash === h) };
}

test("exact duplicate flagged from registry", () => {
  const registry = reg([{ contentHash: "h1", vaultPath: "Sources/a.md" }]);
  const source = { contentHash: "h1", title: "A", sourceUri: "mem://a", warnings: [] };
  const pre = buildPreflight({ source, registry });
  assert.equal(pre.duplicate.exact.vaultPath, "Sources/a.md");
  assert.ok(pre.warnings.some((w) => w.includes("already ingested")));
});

test("no duplicate when hash and slug differ", () => {
  const pre = buildPreflight({ source: { contentHash: "h2", title: "B", sourceUri: "mem://b", warnings: [] }, registry: reg([]) });
  assert.equal(pre.duplicate.exact, null);
  assert.equal(pre.targetPath, "Sources/b.md");
});
