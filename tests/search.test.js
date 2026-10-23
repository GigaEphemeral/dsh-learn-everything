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

test("classifyIntent falls back to combined for missing or blank input", () => {
  const invalid = [undefined, null, "", "   ", 42];
  for (const query of invalid) {
    assert.equal(classifyIntent(query), "combined");
  }
  // A blank query must never be classified as a specific intent.
  assert.equal(classifyIntent(" "), "combined");
});

test("intent markers respect ASCII word boundaries and avoid the broad 值 marker (E7/E8)", () => {
  // "how" inside "show" and "code" inside "decode" must not route.
  assert.equal(classifyIntent("show me the tags"), "combined");
  assert.equal(classifyIntent("decode the payload"), "combined");
  // Real ASCII word matches still route.
  assert.equal(classifyIntent("how does it work"), "concept");
  // Single-char 值 is gone: these used to route to "source".
  assert.equal(classifyIntent("这值得吗"), "combined");
  assert.equal(classifyIntent("价值观"), "combined");
  // Multi-character value markers keep source routing.
  assert.equal(classifyIntent("默认值是多少"), "source");
  assert.equal(classifyIntent("取值范围"), "source");
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

test("retriever fallback terms are not corrupted by substring stopwords (E12)", async () => {
  async function fallbackTerms(query) {
    const calls = [];
    const adapter = {
      async search(q) {
        calls.push(q);
        return q === query ? [] : [{ filename: "hit.md", score: 1, matches: [{ context: "c" }] }];
      },
      async list() {
        return { files: [] };
      },
    };
    const retriever = new SearchRetriever({ adapter });
    await retriever._search(query, { max: 5 });
    return calls.slice(1);
  }
  // Whole-token stopwords must not eat substrings ("data" -> "dt").
  assert.deepEqual(await fallbackTerms("data"), ["data"]);
  assert.deepEqual(await fallbackTerms("theory"), ["theory"]);
  // Boundary stripping must not leave one character ("目的" -> "目").
  assert.deepEqual(await fallbackTerms("目的"), ["目的"]);
  // Question words are stripped at token boundaries.
  assert.deepEqual(await fallbackTerms("什么是间隔重复"), ["间隔重复"]);
  assert.deepEqual(await fallbackTerms("what is data"), ["data"]);
  // Terms are capped.
  assert.equal((await fallbackTerms("alpha beta gamma delta epsilon")).length, 3);
});

test("_search keeps the per-term fallback when the full query has no hits (E12)", async () => {
  const calls = [];
  const adapter = {
    async search(q) {
      calls.push(q);
      return q === "间隔重复 配置" ? [] : [{ filename: "wiki/a.md", score: 1, matches: [] }];
    },
  };
  const retriever = new SearchRetriever({ adapter });
  const hits = await retriever._search("间隔重复 配置");
  assert.deepEqual(calls, ["间隔重复 配置", "间隔重复", "配置"]);
  assert.equal(hits.length, 1); // deduplicated by filename
  assert.equal(hits[0].path, "wiki/a.md");
});

test("wikiFirst excludes log/index/schema under the configured wikiDir (E14)", async () => {
  const hits = [
    { filename: "Knowledge/Wiki/log.md", score: 1, matches: [{ context: "log" }] },
    { filename: "Knowledge/Wiki/index.md", score: 1, matches: [{ context: "index" }] },
    { filename: "Knowledge/Wiki/schema/s.md", score: 1, matches: [{ context: "schema" }] },
    { filename: "Knowledge/Wiki/concepts/a.md", score: 0.9, matches: [{ context: "concept" }] },
    { filename: "Notes/b.md", score: 0.5, matches: [{ context: "note" }] },
  ];
  const adapter = { search: async () => hits };
  const retriever = new SearchRetriever({ adapter, wikiDir: "Knowledge/Wiki" });
  const results = await retriever.wikiFirst("x");
  assert.deepEqual(results.map((result) => result.path), ["Knowledge/Wiki/concepts/a.md", "Notes/b.md"]);
  assert.equal(results[0].resultType, "wiki_page");
});

test("structural listing tolerates non-object adapter responses (E15)", async () => {
  for (const response of [null, undefined, "bad", { files: null }, []]) {
    const retriever = new SearchRetriever({ adapter: { list: async () => response } });
    assert.deepEqual(await retriever._listAll(), []);
  }
  const retriever = new SearchRetriever({ adapter: { list: async () => ({ files: ["a.md", "b.md"] }) } });
  assert.deepEqual(await retriever._listAll(), ["a.md", "b.md"]);
});

test("_search wraps adapter failures with query context and cause (E16)", async () => {
  const cause = new Error("socket hang up");
  const retriever = new SearchRetriever({
    adapter: {
      async search() {
        throw cause;
      },
    },
  });
  await assert.rejects(() => retriever._search("间隔重复"), (err) => {
    assert.match(err.message, /search failed for query "间隔重复"/);
    assert.equal(err.cause, cause);
    return true;
  });
});
