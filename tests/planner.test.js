// Unit tests for the ingest planner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planNote } from "../src/ingest/planner.js";

test("planNote builds a create-only note with frontmatter", () => {
  const source = {
    title: "Alpha",
    sourceUri: "mem://a",
    sourceId: "id123",
    contentHash: "cafe0000",
    fetchedAt: "2026-10-23T00:00:00Z",
    content: "# Alpha\n\nBody",
  };
  const plan = planNote({ source, slug: "alpha" });
  assert.equal(plan.operation, "create");
  assert.equal(plan.targetPath, "Sources/alpha.md");
  assert.ok(plan.content.includes("title: \"Alpha\""));
  assert.ok(plan.content.includes("content_hash: \"cafe0000\""));
  assert.ok(plan.content.includes("# Alpha"));
});
