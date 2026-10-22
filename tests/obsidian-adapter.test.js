// Unit tests for the adapter with a stubbed client (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ObsidianAdapter, ObsidianError, VaultPathError } from "../src/obsidian-adapter.js";

function stubClient(impl) {
  return { request: async (...args) => impl(...args) };
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
