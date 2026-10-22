// Unit tests for source acquisition.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSource, SourceFetchError } from "../src/ingest/source-fetch.js";

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
