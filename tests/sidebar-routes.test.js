// Unit tests for the sidebar data routes (S4, R2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRouteHandlers, registerObsidianRoutes } from "../src/sidebar/routes.js";
import { NOT_CONFIGURED_CODE, routeErrorText } from "../src/sidebar/route-errors.js";
import { ObsidianError } from "../src/obsidian/obsidian-adapter.js";
import { appendCompileEvent } from "../src/obsidian/compile-status.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VAULT_REGISTRY = fileURLToPath(new URL("./fixtures/obsidian-vaults.json", import.meta.url));

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
      health: async () => ({ authenticated: true, ok: true }),
      list: async (dir) => (dir === "wiki/concepts" ? { files: ["a.md"] } : { files: [] }),
      read: async (path) => (path === "wiki/concepts/a.md" ? "# A\nbody" : null),
    },
    retriever: { wikiFirst: async (q) => [{ path: "wiki/concepts/a.md", excerpt: "e", resultType: "wiki_page" }] },
    compileStatusFile: null,
    vaultName: "learnEverything",
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

test("registerObsidianRoutes fences requests and registers nine routes", async () => {
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
  assert.equal(registered.length, 9);
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
  assert.equal(registered.length, 9);
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

test("a missing note returned as an Obsidian 404 is answered as 404, not 500", async () => {
  const data = { ...fakeData(), adapter: { ...fakeData().adapter,
    read: async () => { throw new ObsidianError("not found", { status: 404 }); },
  } };
  const h = makeRouteHandlers(data);
  const res = fakeRes();
  await h.read(fakeReq("/obsidian/api/read?path=wiki/missing.md"), res);
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, "not-found");
});

test("a data-layer construction failure is a configuration error, not 'set the key'", async () => {
  const h = makeRouteHandlers(() => { throw new Error("Invalid URL") });
  const res = fakeRes();
  await h.list(fakeReq("/obsidian/api/list?dir=wiki"), res);
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.parse(res.body).error.code, "obsidian-config");
});

test("compile-status never reads a caller-supplied file path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "routes-status-"));
  const secret = join(dir, "secret.json");
  const { writeFile } = await import("node:fs/promises");
  try {
    await writeFile(secret, JSON.stringify({ stages: [{ at: "x", stage: "done" }], last: { stage: "done" } }));
    const h = makeRouteHandlers({}, { getConfig: () => ({ compileStatusFile: null }) });
    const res = fakeRes();
    await h.compileStatus(fakeReq("/obsidian/compile-status?file=" + encodeURIComponent(secret)), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body).value, { stages: [], last: null });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("compile-status reads the configured file when one is set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "routes-status-"));
  const file = join(dir, "status.json");
  try {
    await appendCompileEvent(file, { stage: "done", source: "Sources/x.md" });
    const h = makeRouteHandlers({}, { getConfig: () => ({ compileStatusFile: file }) });
    const res = fakeRes();
    await h.compileStatus(fakeReq("/obsidian/compile-status"), res);
    assert.equal(JSON.parse(res.body).value.last.stage, "done");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the graph skips an unreadable page instead of blanking the whole graph", async () => {
  const adapter = {
    list: async (dir) => (dir === "wiki/concepts" ? { files: ["a.md", "b.md"] } : { files: [] }),
    read: async (path) => {
      if (path.endsWith("b.md")) throw new ObsidianError("gone", { status: 404 });
      return "[[entities/e]]";
    },
  };
  const h = makeRouteHandlers({ adapter });
  const res = fakeRes();
  await h.graph(fakeReq("/obsidian/graph"), res);
  assert.equal(res.statusCode, 200);
  const value = JSON.parse(res.body).value;
  assert.ok(value.nodes.some((node) => node.id === "concepts/a"));
});

test("the loopback fallback fence accepts IPv6 and rejects non-loopback hosts", async () => {
  const registered = [];
  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: (route) => { registered.push(route); return () => {}; } },
    get: () => undefined,
  };
  registerObsidianRoutes(ctx, { apiKey: "k", createData: () => fakeData() });
  const list = registered[0].handler;
  const ipv6 = fakeRes();
  await list({ ...fakeReq("/obsidian/api/list?dir=wiki/concepts"), headers: { host: "[::1]:3081" } }, ipv6);
  assert.equal(ipv6.statusCode, 200);
  const explicit = fakeRes();
  await list({ ...fakeReq("/obsidian/api/list?dir=wiki/concepts"), headers: { host: "127.0.0.1:3081" } }, explicit);
  assert.equal(explicit.statusCode, 200);
  const remote = fakeRes();
  await list({ ...fakeReq("/obsidian/api/list?dir=wiki/concepts"), headers: { host: "evil.example" } }, remote);
  assert.equal(remote.statusCode, 403);
});
// ---- S4 additions (save-time validation & config surface) ----

test("config route returns non-secret values and hides the apiKey", async () => {
  const h = makeRouteHandlers(fakeData(), {
    getConfig: () => ({ vaultName: "learnEverything", baseUrl: "https://vault.example", apiKey: "secret-key" }),
  });
  const res = fakeRes();
  await h.config(fakeReq("/obsidian/api/config"), res);
  assert.equal(res.statusCode, 200);
  const value = JSON.parse(res.body).value;
  assert.equal(value.vaultName, "learnEverything");
  assert.equal(value.baseUrl, "https://vault.example");
  assert.equal(value.apiKeyConfigured, true);
  assert.equal(res.body.includes("secret-key"), false);
});

test("test-connection proves authentication through an authenticated vault read", async () => {
  const h = makeRouteHandlers(fakeData(), { vaultRegistryFile: VAULT_REGISTRY, getConfig: () => ({ apiKey: "k", baseUrl: "https://h" }) });
  const res = fakeRes();
  await h.testConnection(fakeReq("/obsidian/api/test-connection"), res);
  assert.equal(res.statusCode, 200);
  const v = JSON.parse(res.body).value;
  assert.equal(v.connected, true);
  assert.ok(typeof v.latency === "number");
});

test("an unauthenticated health 200 cannot mask a 401 on the authenticated probe", async () => {
  const data = fakeData();
  data.adapter.health = async () => ({ status: "OK" });
  data.adapter.list = async () => { throw new ObsidianError("401 Unauthorized", { status: 401 }); };
  const h = makeRouteHandlers(data, { vaultRegistryFile: VAULT_REGISTRY, getConfig: () => ({ apiKey: "wrong", baseUrl: "https://h" }) });
  const res = fakeRes();
  await h.testConnection(fakeReq("/obsidian/api/test-connection"), res);
  assert.equal(res.statusCode, 200);
  const v = JSON.parse(res.body).value;
  assert.equal(v.connected, false);
  assert.equal(v.error.code, "unauthorized");
});

test("test-connection route reports failure with an error code", async () => {
  const data = fakeData();
  data.adapter.list = async () => { throw new Error("ECONNREFUSED 127.0.0.1:27124") };
  const h = makeRouteHandlers(data, { vaultRegistryFile: VAULT_REGISTRY, getConfig: () => ({ apiKey: "k", baseUrl: "https://h" }) });
  const res = fakeRes();
  await h.testConnection(fakeReq("/obsidian/api/test-connection"), res);
  assert.equal(res.statusCode, 200);
  const v = JSON.parse(res.body).value;
  assert.equal(v.connected, false);
  assert.equal(v.error.code, "network-error");
});

test("test-connection refuses a wrong staged key (save-time validation)", async () => {
  const h = makeRouteHandlers(null, {
    vaultRegistryFile: VAULT_REGISTRY,
    getConfig: () => ({ apiKey: "configured-key", baseUrl: "https://h" }),
    createData: () => ({ adapter: { list: async () => { throw new ObsidianError("401 Unauthorized", { status: 401 }); } } }),
  });
  const res = fakeRes();
  await h.testConnection(fakeReq("/obsidian/api/test-connection?apiKey=wrong-key"), res);
  assert.equal(res.statusCode, 200);
  const v = JSON.parse(res.body).value;
  assert.equal(v.connected, false);
  assert.equal(v.error.code, "unauthorized");
});

test("test-connection uses a throwaway client for a staged URL", async () => {
  let built = null;
  const h = makeRouteHandlers(null, {
    vaultRegistryFile: VAULT_REGISTRY,
    getConfig: () => ({ apiKey: "configured-key", baseUrl: "https://h" }),
    createData: (opts) => { built = opts; return { adapter: { list: async () => ({ files: [] }) } } },
  });
  const res = fakeRes();
  await h.testConnection(fakeReq("/obsidian/api/test-connection?baseUrl=https%3A%2F%2F127.0.0.1%3A9999"), res);
  assert.equal(res.statusCode, 200);
  assert.equal(built.baseUrl, "https://127.0.0.1:9999");
  assert.equal(built.apiKey, "configured-key");
  assert.equal(JSON.parse(res.body).value.connected, true);
});

test("test-connection reports a malformed staged URL as invalid config", async () => {
  const h = makeRouteHandlers(null, {
    vaultRegistryFile: VAULT_REGISTRY,
    getConfig: () => ({ apiKey: "configured-key", baseUrl: "https://h" }),
    createData: () => { throw new Error("Invalid URL"); },
  });
  const res = fakeRes();
  await h.testConnection(fakeReq("/obsidian/api/test-connection?baseUrl=not-a-url"), res);
  assert.equal(res.statusCode, 200);
  const v = JSON.parse(res.body).value;
  assert.equal(v.connected, false);
  assert.equal(v.error.code, "invalid-config");
});

test("test-connection rejects an unregistered vault name even with a valid key", async () => {
  let built = false;
  const h = makeRouteHandlers(null, {
    vaultRegistryFile: VAULT_REGISTRY,
    getConfig: () => ({ apiKey: "configured-key", baseUrl: "https://h", vaultName: "learnEverything" }),
    createData: () => { built = true; return { adapter: { list: async () => ({ files: [] }) } }; },
  });
  const res = fakeRes();
  await h.testConnection(fakeReq("/obsidian/api/test-connection?vaultName=not-a-vault"), res);
  assert.equal(res.statusCode, 200);
  const v = JSON.parse(res.body).value;
  assert.equal(v.connected, false);
  assert.equal(v.error.code, "unknown-vault");
  assert.ok(v.error.available.includes("learnEverything"));
  assert.equal(built, false, "an unknown vault is rejected before any network probe");
});
