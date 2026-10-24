// Unit tests for the sidebar data routes (S4, R2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRouteHandlers, registerObsidianRoutes } from "../src/sidebar/routes.js";
import { NOT_CONFIGURED_CODE, routeErrorText } from "../src/sidebar/route-errors.js";

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

test("registerObsidianRoutes fences requests and registers seven routes", async () => {
  const registered = [];
  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: (route) => { registered.push(route); return () => {}; } },
    get: (name) => (name === "connection"
      ? { requestRejection: (req) => (req.headers.host === "evil" ? 403 : undefined) }
      : undefined),
  };
  registerObsidianRoutes(ctx, {
    apiKey: "k",
    createData: () => fakeData(),
  });
  assert.equal(registered.length, 7);
  // A fenced request is answered as a JSON envelope, not an empty 400.
  const route = registered[0];
  const res = fakeRes();
  await route.handler({ ...fakeReq("/obsidian/api/list"), headers: { host: "evil" } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error.code, "forbidden");
});

test("routes stay registered without a key and answer 503 instead of 404", async () => {
  const registered = [];
  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: (route) => { registered.push(route); return () => {}; } },
    get: () => undefined,
  };
  registerObsidianRoutes(ctx, {
    getConfig: () => ({ apiKey: "" }),
    createData: () => fakeData(),
  });
  assert.equal(registered.length, 7);
  const res = fakeRes();
  await registered[0].handler({ ...fakeReq("/obsidian/api/list?dir=wiki/concepts"), headers: { host: "127.0.0.1:3082" } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error.code, NOT_CONFIGURED_CODE);
});

test("route error text tells the user how to fix each envelope", () => {
  const missing = routeErrorText({ code: NOT_CONFIGURED_CODE, message: "ignored" });
  assert.match(missing, /插件设置/);
  const fenced = routeErrorText({ code: "forbidden" });
  assert.match(fenced, /token/);
  assert.equal(routeErrorText({ code: "boom", message: "detail" }), "detail");
  assert.equal(routeErrorText(undefined), "请求失败");
});

test("a volatile-style config change takes effect per request without re-registering", async () => {
  let config = { apiKey: "", baseUrl: "https://127.0.0.1:27124" };
  const created = [];
  const registered = [];
  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: (route) => { registered.push(route); return () => {}; } },
    get: () => undefined,
  };
  registerObsidianRoutes(ctx, {
    getConfig: () => config,
    createData: (input) => { created.push(input); return fakeData(); },
  });
  const list = registered[0].handler;
  const headers = { host: "127.0.0.1:3082" };
  const before = fakeRes();
  await list({ ...fakeReq("/obsidian/api/list?dir=wiki/concepts"), headers }, before);
  assert.equal(before.statusCode, 503);
  // Same semantics as a volatile settings commit: the getter now returns a key.
  config = { apiKey: "secret", baseUrl: "https://127.0.0.1:27124" };
  const after = fakeRes();
  await list({ ...fakeReq("/obsidian/api/list?dir=wiki/concepts"), headers }, after);
  assert.equal(after.statusCode, 200);
  assert.equal(created.length, 1, "the data layer is created lazily once configured");
});

test("a connection-service getter that throws is fenced as forbidden, not a 400", async () => {
  const registered = [];
  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: (route) => { registered.push(route); return () => {}; } },
    get: () => { throw new Error("service not available"); },
  };
  registerObsidianRoutes(ctx, { apiKey: "k", createData: () => fakeData() });
  const res = fakeRes();
  await registered[0].handler({ ...fakeReq("/obsidian/api/list"), headers: { host: "127.0.0.1:3082" } }, res);
  assert.equal(res.statusCode, 403);
});
