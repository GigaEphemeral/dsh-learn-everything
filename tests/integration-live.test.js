// Live integration tests against the running Obsidian plugin.
// Skipped unless OBSIDIAN_API_KEY is set. Uses a temp folder cleaned up at the end.
import { test, suite } from "node:test";
import assert from "node:assert/strict";
import { ObsidianClient, ObsidianAdapter, ObsidianError } from "../src/obsidian/obsidian-adapter.js";

const apiKey = process.env.OBSIDIAN_API_KEY;
const baseUrl = process.env.OBSIDIAN_BASE_URL ?? "https://127.0.0.1:27124";

const s = apiKey ? suite : suite.skip;

s("live vault acceptance", () => {
  const client = new ObsidianClient({ baseUrl, apiKey, timeoutMs: 15000 });
  const adapter = new ObsidianAdapter(client);
  const NOTE = "_p1-test/live.md";

  test("list, create, read, conflict, search, frontmatter, delete", async () => {
    const root = await adapter.list();
    assert.ok(Array.isArray(root.files), "list returns a files array");
    assert.ok(root.files.includes("README.md"), "vault root lists the README");

    await adapter.create(NOTE, "---\ntitle: live test\ntags:\n  - p1\n---\n\nHello live.\n");

    const read = await adapter.read(NOTE);
    assert.ok(read.includes("Hello live."), "content round-trips");

    await assert.rejects(
      () => adapter.create(NOTE, "clobber"),
      (err) => err instanceof ObsidianError && err.status === 412,
    );

    const found = await adapter.search("live test");
    assert.ok(JSON.stringify(found).includes(NOTE), "search hits the note");

    await adapter.updateFrontmatter(NOTE, "status", "active");
    await adapter.updateFrontmatter(NOTE, "title", "live updated");
    const after = await adapter.read(NOTE);
    assert.ok(after.includes("status: active"), "new field added");
    assert.ok(after.includes("title: live updated"), "existing field updated");
    assert.ok(after.includes("- p1"), "unrelated tags preserved");

    await adapter.delete(NOTE);
    assert.equal(await adapter.exists(NOTE), false);
  });

  test("nonexistent file maps to 404", async () => {
    await assert.rejects(
      () => adapter.read("_p1-test/does-not-exist.md"),
      (err) => err instanceof ObsidianError && err.status === 404,
    );
  });
});
