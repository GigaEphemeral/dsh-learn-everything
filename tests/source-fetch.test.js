// Unit tests for source acquisition.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchUrl,
  normalizeSource,
  readLocalFile,
  SourceFetchError,
} from "../src/ingest/source-fetch.js";

async function makeTempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), "dsh-fetch-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("normalizeSource produces stable hash and title from first heading", () => {
  const a = normalizeSource({ sourceUri: "mem://1", title: "间隔重复", content: "# 间隔重复\n\n正文" });
  const b = normalizeSource({ sourceUri: "mem://1", title: "间隔重复", content: "# 间隔重复\n\n正文" });
  assert.equal(a.contentHash, b.contentHash);
  assert.equal(a.title, "间隔重复");
  assert.match(a.sourceId, /^[0-9a-f]{16}$/);
});

test("normalizeSource rejects empty content", () => {
  assert.throws(
    () => normalizeSource({ sourceUri: "mem://x", content: "   " }),
    SourceFetchError,
  );
});

test("fetchUrl wraps malformed URLs as SourceFetchError with code url", async () => {
  await assert.rejects(
    () => fetchUrl("not a valid url"),
    (err) => {
      assert.ok(err instanceof SourceFetchError);
      assert.equal(err.code, "url");
      assert.ok(err.cause instanceof TypeError, "the URL parse error must be preserved as cause");
      return true;
    },
  );
});

test("fetchUrl refuses non-HTTPS protocols without network access", async () => {
  await assert.rejects(
    () => fetchUrl("http://127.0.0.1:9/source.md"),
    (err) => {
      assert.ok(err instanceof SourceFetchError);
      assert.equal(err.code, "protocol");
      return true;
    },
  );
});

test("readLocalFile wraps filesystem errors as SourceFetchError with code io", async (t) => {
  const dir = await makeTempDir(t);
  const missing = join(dir, "missing.md");
  await assert.rejects(
    () => readLocalFile(missing),
    (err) => {
      assert.ok(err instanceof SourceFetchError);
      assert.equal(err.code, "io");
      assert.equal(err.cause?.code, "ENOENT");
      assert.ok(err.message.includes(missing), "error must name the file");
      return true;
    },
  );
});

test("readLocalFile returns file content and enforces the size cap", async (t) => {
  const dir = await makeTempDir(t);
  const file = join(dir, "ok.md");
  await writeFile(file, "# doc\n", "utf8");
  assert.equal(await readLocalFile(file), "# doc\n");
  await assert.rejects(
    () => readLocalFile(file, { maxBytes: 2 }),
    (err) => err instanceof SourceFetchError && err.code === "size",
  );
});
