// Unit tests for compile-progress state (S4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCompileStatus, appendCompileEvent, emptyStatus } from "../src/obsidian/compile-status.js";

test("appendCompileEvent records ordered progress and returns the latest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cstat-"));
  const file = join(dir, "status.json");
  try {
    assert.deepEqual(await readCompileStatus(file), emptyStatus());
    await appendCompileEvent(file, { stage: "pending", source: "Sources/x.md" });
    const mid = await appendCompileEvent(file, { stage: "waiting", source: "Sources/x.md" });
    const end = await appendCompileEvent(file, { stage: "done", source: "Sources/x.md" });
    assert.equal(end.stages.length, 3);
    assert.equal(end.last.stage, "done");
    const reread = await readCompileStatus(file);
    assert.equal(reread.last.stage, "done");
    assert.equal(reread.stages[0].stage, "pending");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
