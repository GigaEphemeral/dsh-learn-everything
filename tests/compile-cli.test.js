// Unit tests for the compile CLI pending-source detection (S3, T3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ObsidianError } from "../src/obsidian/obsidian-adapter.js";
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

