// Unit tests for the adapter and HTTP client with stubbed clients and local
// plain-HTTP servers (no external network, no TLS).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ObsidianAdapter, ObsidianClient, ObsidianError, VaultPathError } from "../src/obsidian/obsidian-adapter.js";

function stubClient(impl) {
  return { request: async (...args) => impl(...args) };
}

async function startServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

test("create sends no-overwrite precondition and markdown content-type", async () => {
  const calls = [];
  const client = stubClient(async (method, path, opts) => {
    calls.push({ method, path, opts });
    return undefined;
  });
  const adapter = new ObsidianAdapter(client);
  await adapter.create("Learning/Plans/p.md", "body");
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].path, "/vault/Learning/Plans/p.md");
  assert.equal(calls[0].opts.headers["If-None-Match"], "*");
  assert.equal(calls[0].opts.headers["Content-Type"], "text/markdown");
});

test("create conflict surfaces as a 412 ObsidianError", async () => {
  const client = stubClient(async () => {
    throw new ObsidianError("file exists", { status: 412 });
  });
  const adapter = new ObsidianAdapter(client);
  await assert.rejects(() => adapter.create("x.md", "b"), (err) => err.status === 412);
});

test("updateFrontmatter uses replace operation and preserves-others contract", async () => {
  const calls = [];
  const client = stubClient(async (method, path, opts) => {
    calls.push({ method, path, opts });
    return undefined;
  });
  const adapter = new ObsidianAdapter(client);
  await adapter.updateFrontmatter("x.md", "status", "active");
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].path, "/vault/x.md/frontmatter/status");
  assert.equal(calls[0].opts.headers.Operation, "replace");
  assert.equal(calls[0].opts.headers["Create-Target-If-Missing"], "true");
  assert.equal(calls[0].opts.body, '"active"');
  // undefined/null must not produce a body-less replace (C4).
  await adapter.updateFrontmatter("x.md", "note", undefined);
  assert.equal(calls[1].path, "/vault/x.md/frontmatter/note");
  assert.equal(calls[1].opts.body, "null");
  await adapter.updateFrontmatter("x.md", "archived", false);
  assert.equal(calls[2].opts.body, "false");
});

test("scope rejects paths outside the configured scope", async () => {
  const client = stubClient(async () => undefined);
  const adapter = new ObsidianAdapter(client, { scope: "learnEverything" });
  assert.throws(() => adapter._path("Other/x.md"), VaultPathError);
  assert.equal(adapter._path("learnEverything/x.md"), "learnEverything/x.md");
});

test("exists maps 404 to false and rethrows other errors", async () => {
  const client = stubClient(async (m, p) => {
    if (p.endsWith("missing.md")) throw new ObsidianError("not found", { status: 404 });
    if (p.endsWith("broken.md")) throw new ObsidianError("server error", { status: 500 });
    return "ok";
  });
  const adapter = new ObsidianAdapter(client);
  assert.equal(await adapter.exists("missing.md"), false);
  assert.equal(await adapter.exists("here.md"), true);
  await assert.rejects(() => adapter.exists("broken.md"), (err) => err.status === 500);
});

test("ObsidianClient rejects non-string/Buffer bodies before writing (C11)", async () => {
  const client = new ObsidianClient({ baseUrl: "http://127.0.0.1:1", apiKey: "k" });
  for (const body of [42, { a: 1 }, ["x"], true]) {
    await assert.rejects(
      () => client.request("PUT", "/vault/x.md", { body }),
      (err) => err instanceof TypeError && /body must be a string or Buffer/.test(err.message),
    );
  }
});

test("ObsidianClient accepts Buffer bodies and measures their byte length", async () => {
  let contentLength;
  const server = await startServer((req, res) => {
    contentLength = req.headers["content-length"];
    req.resume();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });
  try {
    const client = new ObsidianClient({ baseUrl: server.baseUrl, apiKey: "k", timeoutMs: 2000 });
    assert.deepEqual(await client.request("PUT", "/vault/x.md", { body: Buffer.from("héllo") }), {});
    assert.equal(contentLength, String(Buffer.byteLength("héllo")));
  } finally {
    await server.close();
  }
});

test("ObsidianClient clears the deadline once headers arrive so slow bodies complete (C10)", async () => {
  const server = await startServer((req, res) => {
    req.resume();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"ok":');
    setTimeout(() => res.end("true}"), 250);
  });
  try {
    const client = new ObsidianClient({ baseUrl: server.baseUrl, apiKey: "k", timeoutMs: 50 });
    assert.deepEqual(await client.request("GET", "/vault/x"), { ok: true });
  } finally {
    await server.close();
  }
});

test("ObsidianClient still enforces the overall deadline when no response arrives (C10)", async () => {
  const server = await startServer((req) => {
    req.resume(); // Accept the request but never respond.
  });
  try {
    const client = new ObsidianClient({ baseUrl: server.baseUrl, apiKey: "k", timeoutMs: 60 });
    const started = Date.now();
    await assert.rejects(() => client.request("GET", "/vault/x"), (err) => {
      assert.ok(err instanceof ObsidianError);
      assert.match(err.message, /timed out after 60ms/);
      return true;
    });
    assert.ok(Date.now() - started < 2000);
  } finally {
    await server.close();
  }
});

test("ObsidianClient maps empty HTTP error bodies to `HTTP <status>` (C12)", async () => {
  const server = await startServer((req, res) => {
    req.resume();
    res.writeHead(500);
    res.end();
  });
  try {
    const client = new ObsidianClient({ baseUrl: server.baseUrl, apiKey: "k", timeoutMs: 2000 });
    await assert.rejects(() => client.request("GET", "/vault/x"), (err) => {
      assert.ok(err instanceof ObsidianError);
      assert.equal(err.status, 500);
      assert.equal(err.message, "HTTP 500");
      return true;
    });
  } finally {
    await server.close();
  }
});

test("ObsidianClient keeps JSON error message and errorCode mapping (C12)", async () => {
  const server = await startServer((req, res) => {
    req.resume();
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "invalid key", errorCode: 40101 }));
  });
  try {
    const client = new ObsidianClient({ baseUrl: server.baseUrl, apiKey: "k", timeoutMs: 2000 });
    await assert.rejects(() => client.request("GET", "/vault/x"), (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.message, "invalid key");
      assert.equal(err.errorCode, 40101);
      return true;
    });
  } finally {
    await server.close();
  }
});

test("ObsidianClient wraps transport failures as ObsidianError (C12)", async () => {
  const server = await startServer((req, res) => {
    req.resume();
    res.end("{}");
  });
  const { baseUrl } = server;
  await server.close();
  const client = new ObsidianClient({ baseUrl, apiKey: "k", timeoutMs: 500 });
  await assert.rejects(() => client.request("GET", "/vault/x"), (err) => {
    assert.ok(err instanceof ObsidianError);
    assert.equal(err.status, 0);
    assert.match(err.message, /Obsidian request failed/);
    return true;
  });
});
