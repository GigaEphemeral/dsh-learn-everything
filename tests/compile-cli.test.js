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
  assert.deepEqual(pending, ["c"]);
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

