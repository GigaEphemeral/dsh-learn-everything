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

test("a truncated or wrong-shaped status file degrades to empty status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cstat-"));
  const file = join(dir, "status.json");
  const { writeFile } = await import("node:fs/promises");
  try {
    await writeFile(file, "{not json");
    assert.deepEqual(await readCompileStatus(file), emptyStatus());
    await writeFile(file, JSON.stringify(null));
    assert.deepEqual(await readCompileStatus(file), emptyStatus());
    await writeFile(file, JSON.stringify({ last: { stage: "done" } }));
    assert.deepEqual(await readCompileStatus(file), emptyStatus());
    // A valid status recovers after a bad write.
    await appendCompileEvent(file, { stage: "done" });
    assert.equal((await readCompileStatus(file)).last.stage, "done");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("appendCompileEvent rejects an unknown stage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cstat-"));
  const file = join(dir, "status.json");
  try {
    await assert.rejects(() => appendCompileEvent(file, { stage: "Done" }), /unknown compile stage/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
