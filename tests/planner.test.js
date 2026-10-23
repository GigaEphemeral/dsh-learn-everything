// Unit tests for the ingest planner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planNote } from "../src/ingest/planner.js";

function makeSource(overrides = {}) {
  return {
    title: "Alpha",
    sourceUri: "mem://a",
    sourceId: "id123",
    contentHash: "cafe0000123456789abcdef",
    fetchedAt: "2026-10-23T00:00:00Z",
    content: "# Alpha\n\nBody",
    ...overrides,
  };
}

test("planNote builds a create-only note with frontmatter", () => {
  const plan = planNote({ source: makeSource(), slug: "alpha" });
  assert.equal(plan.operation, "create");
  assert.equal(plan.slug, "alpha");
  assert.equal(plan.targetPath, "Sources/alpha.md");
  assert.ok(plan.content.includes('title: "Alpha"'));
  assert.ok(plan.content.includes('content_hash: "cafe000012345678"'));
  assert.ok(plan.content.includes("# Alpha"));
});

test("planNote coerces missing optional fields instead of writing undefined", () => {
  const plan = planNote({ source: makeSource({ sourceId: undefined, fetchedAt: undefined }), slug: "alpha" });
  assert.ok(plan.content.includes('source_id: ""'));
  assert.ok(plan.content.includes('fetched_at: ""'));
  assert.ok(!plan.content.includes("undefined"));
});

test("planNote validates required source fields", () => {
  assert.throws(
    () => planNote({ source: makeSource({ contentHash: "" }), slug: "alpha" }),
    /missing required field\(s\): contentHash/,
  );
  assert.throws(
    () => planNote({ source: makeSource({ content: "   " }), slug: "alpha" }),
    /missing required field\(s\): content/,
  );
  assert.throws(
    () => planNote({ source: makeSource({ sourceUri: undefined }), slug: "alpha" }),
    /missing required field\(s\): sourceUri/,
  );
  assert.throws(() => planNote({ source: null, slug: "alpha" }), /source object is required/);
});

test("planNote rejects unsafe slugs", () => {
  assert.throws(() => planNote({ source: makeSource(), slug: "../evil" }), /single path segment/);
  assert.throws(() => planNote({ source: makeSource(), slug: "/absolute" }), /single path segment/);
  assert.throws(() => planNote({ source: makeSource(), slug: "My Note" }), /unsupported characters/);
  assert.throws(() => planNote({ source: makeSource(), slug: "" }), /must not be empty/);
  assert.throws(() => planNote({ source: makeSource() }), /slug must be a string/);
});
