// Unit tests for wiki graph extraction (S4, plan A).
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeNodeId, nodeTypeFor, labelFor, parseWikiLinks, buildGraph } from "../src/wiki/graph.js";

test("normalizeNodeId strips wiki prefix and .md", () => {
  assert.equal(normalizeNodeId("wiki/concepts/x.md"), "concepts/x");
  assert.equal(normalizeNodeId("concepts/x"), "concepts/x");
  assert.equal(normalizeNodeId("wiki/entities/@a.md"), "entities/@a");
});

test("nodeTypeFor classifies dirs", () => {
  assert.equal(nodeTypeFor("concepts/x"), "concept");
  assert.equal(nodeTypeFor("entities/@y"), "entity");
  assert.equal(nodeTypeFor("sources/z"), "source");
  assert.equal(nodeTypeFor("notes/x"), "other");
});

test("labelFor strips karpathywiki hash suffixes", () => {
  assert.equal(labelFor("concepts/dsh-bundle-patch"), "dsh-bundle-patch");
  assert.equal(labelFor("sources/dsh-plugin-dev-patterns_784a21"), "dsh-plugin-dev-patterns");
});

test("parseWikiLinks extracts aliased links", () => {
  assert.deepEqual(parseWikiLinks("[[concepts/a|cordis patch]] and [[entities/@b]]"), ["concepts/a", "entities/@b"]);
  assert.deepEqual(parseWikiLinks(null), []);
});

test("buildGraph creates nodes and edges from [[links]]", () => {
  const pages = [
    { path: "wiki/concepts/a.md", content: "A links to [[concepts/b]] and [[entities/@e]]." },
    { path: "wiki/concepts/b.md", content: "B links to [[concepts/a]]." },
    { path: "wiki/entities/@e.md", content: "E." },
  ];
  const g = buildGraph(pages);
  assert.equal(g.nodes.length, 3);
  assert.equal(g.edges.length, 3);
  const types = g.nodes.map((n) => n.type).sort();
  assert.deepEqual(types, ["concept", "concept", "entity"]);
  assert.equal(g.edges.some((e) => e.source === "concepts/a" && e.target === "concepts/b"), true);
});
