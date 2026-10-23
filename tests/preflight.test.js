// Unit tests for the ingest preflight.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreflight } from "../src/ingest/preflight.js";

function reg(records) {
  return { findByHash: (hash) => records.find((record) => record.contentHash === hash) };
}

function makeSource(overrides = {}) {
  return {
    title: "Alpha Note",
    sourceUri: "mem://a",
    contentHash: "abcdef0123456789",
    warnings: [],
    ...overrides,
  };
}

function listingAdapter(files) {
  return { list: async () => ({ files }) };
}

test("exact duplicate flagged from registry", async () => {
  const registry = reg([{ contentHash: "h1", vaultPath: "Sources/a.md" }]);
  const pre = await buildPreflight({ source: makeSource({ contentHash: "h1", title: "A" }), registry });
  assert.equal(pre.duplicate.exact.vaultPath, "Sources/a.md");
  assert.equal(pre.duplicate.slugMatch, false);
  assert.ok(pre.warnings.some((warning) => warning.includes("already ingested")));
});

test("no duplicate when hash and slug differ", async () => {
  const pre = await buildPreflight({ source: makeSource({ contentHash: "h2", title: "B" }), registry: reg([]) });
  assert.equal(pre.duplicate.exact, null);
  assert.equal(pre.slug, "b");
  assert.equal(pre.targetPath, "Sources/b.md");
});

test("an unusable title falls back deterministically to source-<hash8>", async () => {
  const pre = await buildPreflight({
    source: makeSource({ title: "!!!", contentHash: "abcdef0123456789" }),
    registry: reg([]),
  });
  assert.equal(pre.slug, "source-abcdef01");
  assert.equal(pre.targetPath, "Sources/source-abcdef01.md");
  assert.ok(pre.warnings.some((warning) => warning.includes("empty slug")));
});

test("an explicit slug override is validated and becomes the target", async () => {
  const pre = await buildPreflight({ source: makeSource(), registry: reg([]), slug: "custom-name" });
  assert.equal(pre.slug, "custom-name");
  assert.equal(pre.targetPath, "Sources/custom-name.md");
});

test("explicit empty or unsafe slugs are rejected", async () => {
  for (const slug of ["", "   ", "../evil", "a/b", "C:\\evil", "."]) {
    await assert.rejects(
      () => buildPreflight({ source: makeSource(), registry: reg([]), slug }),
      /slug/,
      `slug ${JSON.stringify(slug)} must be rejected`,
    );
  }
});

test("warnings default to an empty array when the source has none", async () => {
  const pre = await buildPreflight({ source: makeSource({ warnings: "not-an-array" }), registry: reg([]) });
  assert.deepEqual(pre.warnings, []);
});

test("slug duplicate compares the wiki basename without .md exactly", async () => {
  const exact = await buildPreflight({
    source: makeSource(),
    registry: reg([]),
    adapter: listingAdapter(["wiki/sources/alpha-note.md", "wiki/sources/alpha-note-extra.md"]),
  });
  assert.equal(exact.duplicate.slugMatch, true);

  // A plain startsWith() match would wrongly flag this one.
  const prefixOnly = await buildPreflight({
    source: makeSource(),
    registry: reg([]),
    adapter: listingAdapter(["wiki/sources/alpha-note-extra.md"]),
  });
  assert.equal(prefixOnly.duplicate.slugMatch, false);
});

test("a failing wiki listing becomes a warning, not a preflight failure", async () => {
  const adapter = {
    list: async () => {
      throw new Error("vault offline");
    },
  };
  const pre = await buildPreflight({ source: makeSource(), registry: reg([]), adapter });
  assert.equal(pre.duplicate.slugMatch, false);
  assert.ok(pre.warnings.some((warning) => warning.includes("vault offline")));
});

test("a malformed wiki listing becomes a warning", async () => {
  const pre = await buildPreflight({ source: makeSource(), registry: reg([]), adapter: { list: async () => null } });
  assert.equal(pre.duplicate.slugMatch, false);
  assert.ok(pre.warnings.some((warning) => warning.includes("no file list")));
});
