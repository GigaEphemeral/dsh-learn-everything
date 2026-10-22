// Unit tests for the source registry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SourceRegistry } from "../src/ingest/registry.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("registry persists records and finds by hash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-reg-"));
  const file = join(dir, "sources.json");
  const reg = new SourceRegistry({ filePath: file });
  await reg.load();
  reg.add({ contentHash: "abc123", sourceUri: "mem://1", title: "T", vaultPath: "Sources/t.md" });
  await reg.save();
  const reg2 = new SourceRegistry({ filePath: file });
  await reg2.load();
  assert.equal(reg2.findByHash("abc123").vaultPath, "Sources/t.md");
  assert.equal(reg2.findByHash("nope"), undefined);
  await rm(dir, { recursive: true, force: true });
});
