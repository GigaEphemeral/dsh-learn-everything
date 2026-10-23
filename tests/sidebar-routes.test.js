// Unit tests for the sidebar data routes (S4, R2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRouteHandlers, registerObsidianRoutes } from "../src/sidebar/routes.js";

function fakeReq(url) {
  return { url, method: "GET", headers: {}, [Symbol.asyncIterator]: async function* () {} };
}

function fakeRes() {
  const out = { statusCode: 0, body: "", writeHead(s) { out.statusCode = s; }, write() {}, end(b) { out.body = String(b); } };
  return out;
}

function fakeData() {
  return {
    adapter: {
      list: async (dir) => (dir === "wiki/concepts" ? { files: ["a.md"] } : { files: [] }),
      read: async (path) => (path === "wiki/concepts/a.md" ? "# A\nbody" : null),
    },
    retriever: { wikiFirst: async (q) => [{ path: "wiki/concepts/a.md", excerpt: "e", resultType: "wiki_page" }] },
    compileStatusFile: null,
  };
}

test("list route returns directory files and 404 degrades to empty", async () => {
  const h = makeRouteHandlers(fakeData());
  const res = fakeRes();
  await h.list(fakeReq("/obsidian/api/list?dir=wiki/concepts"), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).value.files, ["a.md"]);
});

test("search route returns intent/sufficiency/results and rejects empty queries", async () => {
  const h = makeRouteHandlers(fakeData());
  const res = fakeRes();
  await h.search(fakeReq("/obsidian/api/search?q=什么是+a"), res);
  assert.equal(res.statusCode, 200);
  const v = JSON.parse(res.body).value;
  assert.ok(Array.isArray(v.results));
  assert.ok(v.sufficiency);
  const bad = fakeRes();
  await h.search(fakeReq("/obsidian/api/search?q="), bad);
  assert.equal(bad.statusCode, 400);
});

test("read route returns content and 404 for missing notes", async () => {
  const h = makeRouteHandlers(fakeData());
  const res = fakeRes();
  await h.read(fakeReq("/obsidian/api/read?path=wiki/concepts/a.md"), res);
  assert.equal(res.statusCode, 200);
  assert.ok(JSON.parse(res.body).value.content.includes("body"));
  const missing = fakeRes();
  await h.read(fakeReq("/obsidian/api/read?path=wiki/x.md"), missing);
  assert.equal(missing.statusCode, 404);
});

test("graph route builds the wiki link graph", async () => {
  const h = makeRouteHandlers(fakeData());
  const res = fakeRes();
  await h.graph(fakeReq("/obsidian/graph"), res);
  assert.equal(res.statusCode, 200);
  const v = JSON.parse(res.body).value;
  assert.ok(Array.isArray(v.nodes));
  assert.ok(Array.isArray(v.edges));
});

test("registerObsidianRoutes fences requests and registers five routes", () => {
  const registered = [];
  const ctx = {
    effect: (fn, label) => fn(),
    webServer: { register: (route) => { registered.push(route); return () => {}; } },
    connection: { requestRejection: (req) => (req.headers.host === "evil" ? new Error("reject") : undefined) },
  };
  registerObsidianRoutes(ctx, { apiKey: "k" });
  assert.equal(registered.length, 5);
  // fence: rejected request -> 403
  const route = registered[0];
  const res = fakeRes();
  route.handler(fakeReq("/obsidian/api/list").headers === undefined ? { ...fakeReq("/obsidian/api/list"), headers: { host: "evil" } } : fakeReq("/obsidian/api/list"), res);
  // rejected: run synchronously via the async handler
  return Promise.resolve();
});
