// Unit tests for the search router (P4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent } from "../src/search/intent.js";
import { SearchRetriever } from "../src/search/retriever.js";

test("classifyIntent routes concept / source / structure / combined", () => {
  assert.equal(classifyIntent("什么是间隔重复"), "concept");
  assert.equal(classifyIntent("间隔重复的复习间隔配置"), "source");
  assert.equal(classifyIntent("标签有哪些"), "structure");
  assert.equal(classifyIntent("解释配置参数"), "combined");
  assert.equal(classifyIntent("间隔重复"), "combined");
});

test("wikiFirst normalizes results and ranks wiki pages first", async () => {
  const hits = [
    { filename: "notes/a.md", score: 1, matches: [{ context: "aaa" }] },
    { filename: "wiki/concepts/间隔重复.md", score: 0.8, matches: [{ context: "定义" }] },
    { filename: "Sources/b.md", score: 0.7, matches: [{ context: "bbb" }] },
  ];
  const adapter = { search: async () => hits };
  const retriever = new SearchRetriever({ adapter });
  const results = await retriever.wikiFirst("间隔重复");
  assert.equal(results[0].resultType, "wiki_page");
  assert.equal(results[0].path, "wiki/concepts/间隔重复.md");
  assert.equal(results[1].resultType, "source_note");
  assert.equal(results[2].resultType, "search_result");
  assert.ok(results.every((r) => r.path && r.excerpt && r.confidence));
  assert.ok(!results.some((r) => r.path === "wiki/log.md" || r.path === "wiki/index.md"));
});
