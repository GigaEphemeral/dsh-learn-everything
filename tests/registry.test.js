// Unit tests for the source registry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SourceRegistry } from "../src/ingest/registry.js";
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, stat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function makeTempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), "dsh-reg-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function record(contentHash, extra = {}) {
  return {
    contentHash,
    sourceUri: `mem://${contentHash}`,
    title: `T ${contentHash}`,
    vaultPath: `Sources/${contentHash}.md`,
    ...extra,
  };
}

async function listTempFiles(dir) {
  const entries = await readdir(dir);
  return entries.filter((name) => name.endsWith(".tmp"));
}

test("registry persists records and finds by hash", async (t) => {
  const dir = await makeTempDir(t);
  const file = join(dir, "sources.json");
  const reg = new SourceRegistry({ filePath: file });
  await reg.load();
  reg.add({ contentHash: "abc123", sourceUri: "mem://1", title: "T", vaultPath: "Sources/t.md" });
  await reg.save();
  const reg2 = new SourceRegistry({ filePath: file });
  await reg2.load();
  assert.equal(reg2.findByHash("abc123").vaultPath, "Sources/t.md");
  assert.equal(reg2.findByHash("nope"), undefined);
});

test("load() treats only a missing file as an empty registry", async (t) => {
  const dir = await makeTempDir(t);
  const file = join(dir, "sources.json");
  const reg = new SourceRegistry({ filePath: file });
  await reg.load();
  assert.deepEqual(reg.records, []);
  assert.deepEqual(reg.findByUri("mem://missing"), []);
  // Loading must not create the file as a side effect.
  await assert.rejects(() => readFile(file, "utf8"), { code: "ENOENT" });
});

test("load() rejects corrupt JSON and leaves the file untouched", async (t) => {
  const dir = await makeTempDir(t);
  const file = join(dir, "sources.json");
  const corrupt = '{ "records": [ { "contentHash": "abc" }';
  await writeFile(file, corrupt, "utf8");
  const reg = new SourceRegistry({ filePath: file });

  await assert.rejects(
    () => reg.load(),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /failed to parse registry JSON/);
      assert.ok(err.message.includes(file), "error must name the registry file");
      assert.ok(err.cause instanceof SyntaxError, "parse cause must be preserved");
      return true;
    },
  );
  // A silent reset here would let the next save overwrite the history.
  assert.equal(await readFile(file, "utf8"), corrupt);
});

test("load() rejects non-ENOENT read errors instead of resetting records", async (t) => {
  const dir = await makeTempDir(t);
  const file = join(dir, "sources.json");
  // A directory at the registry path makes readFile fail with EISDIR.
  await mkdir(file);
  const reg = new SourceRegistry({ filePath: file });

  await assert.rejects(
    () => reg.load(),
    (err) => {
      assert.match(err.message, /failed to read registry/);
      assert.ok(err.message.includes(file), "error must name the registry file");
      assert.equal(err.cause?.code, "EISDIR");
      return true;
    },
  );
  assert.deepEqual(reg.records, []);
});

test("load() rejects valid JSON whose shape is not { records: [] }", async (t) => {
  const dir = await makeTempDir(t);
  const cases = [
    { records: {} },
    { records: "nope" },
    { records: null },
    { records: 42 },
    {},
    [],
    "records",
    null,
  ];
  for (const [index, value] of cases.entries()) {
    const file = join(dir, `sources-${index}.json`);
    const raw = JSON.stringify(value);
    await writeFile(file, raw, "utf8");
    const reg = new SourceRegistry({ filePath: file });
    await assert.rejects(
      () => reg.load(),
      (err) => {
        assert.match(err.message, /invalid registry shape/, `case ${index}: ${raw}`);
        assert.ok(err.message.includes(file), `case ${index}: error must name the registry file`);
        return true;
      },
      `case ${index}: ${raw}`,
    );
    assert.equal(await readFile(file, "utf8"), raw, `case ${index}: file must stay unchanged`);
  }
});

test("save() replaces the registry atomically via a same-directory temp file", async (t) => {
  const dir = await makeTempDir(t);
  const file = join(dir, "sources.json");
  const reg = new SourceRegistry({ filePath: file });
  reg.add(record("first"));
  await reg.save();
  const before = await stat(file);

  reg.add(record("second"));
  await reg.save();
  const after = await stat(file);

  // rename() publishes a new inode; an in-place writeFile would keep the old one,
  // so reverting to the non-atomic write fails this assertion.
  if (process.platform !== "win32") {
    assert.notEqual(after.ino, before.ino);
  }

  assert.deepEqual(await listTempFiles(dir), [], "no temp file may survive a successful save");
  const raw = await readFile(file, "utf8");
  assert.equal(raw, JSON.stringify({ records: reg.records }, null, 2));
  const reloaded = await new SourceRegistry({ filePath: file }).load();
  assert.deepEqual(
    reloaded.records.map((r) => r.contentHash),
    ["first", "second"],
  );
});

test("save() cleans up the temp file when publishing fails", async (t) => {
  const dir = await makeTempDir(t);
  // A directory at the destination path lets the temp write succeed but makes
  // rename() fail, which exercises the cleanup path.
  const file = join(dir, "sources.json");
  await mkdir(file);
  const reg = new SourceRegistry({ filePath: file });
  reg.add(record("only"));

  await assert.rejects(
    () => reg.save(),
    (err) => {
      assert.match(err.message, /failed to write registry/);
      assert.ok(err.message.includes(file), "error must name the registry file");
      return true;
    },
  );
  assert.deepEqual(await listTempFiles(dir), [], "a failed save must not leave a temp file");
  assert.equal((await stat(file)).isDirectory(), true);
});

test("failed save preserves a pre-existing registry file", async (t) => {
  const dir = await makeTempDir(t);
  const locked = join(dir, "locked");
  await mkdir(locked);
  const file = join(locked, "sources.json");
  const original = JSON.stringify({ records: [record("kept")] }, null, 2);
  await writeFile(file, original, "utf8");
  await chmod(locked, 0o555);

  try {
    const reg = new SourceRegistry({ filePath: file });
    reg.add(record("added"));
    await assert.rejects(
      () => reg.save(),
      (err) => {
        assert.match(err.message, /failed to write registry/);
        assert.ok(err.message.includes(file), "error must name the registry file");
        return true;
      },
    );
    assert.equal(await readFile(file, "utf8"), original, "previous registry must not be truncated");
    assert.deepEqual(await listTempFiles(locked), [], "a failed save must not leave a temp file");
  } finally {
    await chmod(locked, 0o755);
  }
});

test("add() rejects records without a content hash or source URI", async (t) => {
  const dir = await makeTempDir(t);
  const reg = new SourceRegistry({ filePath: join(dir, "sources.json") });

  assert.throws(() => reg.add({ sourceUri: "mem://x" }), /contentHash is required/);
  assert.throws(() => reg.add({ contentHash: "  ", sourceUri: "mem://x" }), /contentHash is required/);
  assert.throws(() => reg.add({ contentHash: "hash" }), /sourceUri is required/);
  assert.throws(() => reg.add({ contentHash: "hash", sourceUri: "" }), /sourceUri is required/);
  assert.deepEqual(reg.records, []);
});

test("add() skips exact duplicates (same hash and URI) but keeps other origins", async (t) => {
  const dir = await makeTempDir(t);
  const reg = new SourceRegistry({ filePath: join(dir, "sources.json") });
  const record = { contentHash: "hash-1", sourceUri: "mem://a", title: "A", vaultPath: "Sources/a.md" };

  reg.add(record);
  reg.add({ ...record });
  assert.equal(reg.records.length, 1, "an exact duplicate must not be appended twice");

  reg.add({ ...record, sourceUri: "mem://b", vaultPath: "Sources/b.md" });
  assert.equal(reg.records.length, 2, "the same content from a different origin is still recorded");
});
