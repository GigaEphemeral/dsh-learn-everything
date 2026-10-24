// Unit tests for the wiki-graph CLI collector (S4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ObsidianError } from "../src/obsidian/obsidian-adapter.js";
import { collectGraph } from "../scripts/wiki-graph.mjs";

test("collectGraph lists shared WIKI_DIRS, skips 404 pages, and builds the graph", async () => {
  const adapter = {
    list: async (dir) => {
      if (dir === "wiki/concepts") return { files: ["a.md", "gone.md"] };
      if (dir === "wiki/entities") throw new ObsidianError("missing", { status: 404 });
      if (dir === "wiki/sources") return { files: ["s.md"] };
      throw new Error("unexpected " + dir);
    },
    read: async (path) => {
      if (path === "wiki/concepts/a.md") return "[[entities/e]] [[concepts/b]]";
      if (path === "wiki/concepts/gone.md") throw new ObsidianError("gone", { status: 404 });
      if (path === "wiki/sources/s.md") return "[[concepts/a]]";
      throw new Error("unexpected read " + path);
    },
  };
  const graph = await collectGraph(adapter);
  assert.equal(graph.nodes.some((node) => node.id === "concepts/a"), true);
  assert.equal(graph.edges.some((edge) => edge.source === "concepts/a" && edge.target === "concepts/b"), true);
  assert.equal(graph.nodes.some((node) => node.id === "concepts/gone"), false);
});
