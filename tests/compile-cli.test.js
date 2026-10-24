// Unit tests for the compile CLI pending-source detection (S3, T3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ObsidianError } from "../src/obsidian/obsidian-adapter.js";
import { mkdtemp, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
const execFile = promisify(execFileCallback);
import { pendingSources } from "../scripts/compile-cli.mjs";

test("pendingSources lists sources without a compiled wiki/sources page", async () => {
  const adapter = {
    list: async (dir) => {
      if (dir === "Sources") return { files: ["a.md", "b.md", "c.md"] };
      if (dir === "wiki/sources") return { files: ["a_abc123.md", "b.md"] };
      throw new Error("unexpected dir " + dir);
    },
  };
  const pending = await pendingSources(adapter);
  // Full source paths chain directly into the compile mode.
  assert.deepEqual(pending, ["Sources/c.md"]);
});

test("pendingSources only accepts the wiki hash suffix, not any underscore prefix", async () => {
  const adapter = {
    list: async (dir) => {
      if (dir === "Sources") return { files: ["foo.md", "foo_bar.md"] };
      // foo_bar was compiled; foo was not. A plain prefix match would hide foo.
      if (dir === "wiki/sources") return { files: ["foo_bar_abc123.md"] };
      throw new Error("unexpected dir " + dir);
    },
  };
  assert.deepEqual(await pendingSources(adapter), ["Sources/foo.md"]);
});

test("pendingSources compares Markdown extensions case-insensitively and ignores non-Markdown pages", async () => {
  const adapter = {
    list: async (dir) => {
      if (dir === "Sources") return { files: ["FOO.MD", "bar.md"] };
      // A directory/attachment named like the slug is not a compiled page.
      if (dir === "wiki/sources") return { files: ["bar_abc123.md", "foo"] };
      throw new Error("unexpected dir " + dir);
    },
  };
  assert.deepEqual(await pendingSources(adapter), ["Sources/FOO.MD"]);
});

test("pendingSources treats a missing Sources dir as empty", async () => {
  const adapter = {
    list: async (dir) => {
      if (dir === "Sources") throw new ObsidianError("not found", { status: 404 });
      if (dir === "wiki/sources") return { files: ["x_1.md"] };
      throw new Error("unexpected");
    },
  };
  assert.deepEqual(await pendingSources(adapter), []);
});

test("pendingSources surfaces non-404 errors", async () => {
  const adapter = {
    list: async (dir) => {
      if (dir === "Sources") throw new ObsidianError("boom", { status: 500 });
      return { files: [] };
    },
  };
  await assert.rejects(() => pendingSources(adapter), /boom/);
});


test("recordCompileEvent never rejects when status bookkeeping fails", async () => {
  const { recordCompileEvent } = await import("../scripts/compile-cli.mjs");
  const dir = await mkdtemp(join(tmpdir(), "compile-cli-"));
  try {
    await chmod(dir, 0o500);
    await recordCompileEvent(join(dir, "status.json"), { stage: "done", source: "Sources/x.md" });
    assert.ok(true, "a failed status write is swallowed");
  } finally {
    await chmod(dir, 0o700);
    await rm(dir, { recursive: true, force: true });
  }
});

test("status mode works without OBSIDIAN_API_KEY", async () => {
  const dir = await mkdtemp(join(tmpdir(), "compile-cli-"));
  try {
    const env = { ...process.env, OBSIDIAN_STATE_DIR: dir };
    delete env.OBSIDIAN_API_KEY;
    const { stdout } = await execFile(process.execPath, ["scripts/compile-cli.mjs", "status"], { env });
    assert.deepEqual(JSON.parse(stdout), { stages: [], last: null });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
