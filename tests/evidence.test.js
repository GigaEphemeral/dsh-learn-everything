// Unit tests for the S1 evidence model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEvidence, assessSufficiency } from "../src/search/evidence.js";

test("normalizeEvidence classifies wiki/source/search and keeps the real path", () => {
  const wiki = normalizeEvidence({ path: "wiki/concepts/x.md", excerpt: "e" });
  assert.equal(wiki.resultType, "wiki_page");
  assert.equal(wiki.path, "wiki/concepts/x.md");
  const src = normalizeEvidence({ path: "Sources/x.md", excerpt: "e" });
  assert.equal(src.resultType, "source_note");
  assert.equal(src.sourceNote, "Sources/x.md");
  const plain = normalizeEvidence({ path: "notes/x.md", excerpt: "e" });
  assert.equal(plain.resultType, "search_result");
  assert.ok(wiki.confidence === "candidate");
});

test("sufficiency: no evidence is insufficient", () => {
  const r = assessSufficiency("问题", []);
  assert.equal(r.sufficient, false);
  assert.equal(r.level, "none");
});

test("sufficiency: concept question supported by wiki pages", () => {
  const ev = [normalizeEvidence({ path: "wiki/concepts/x.md", excerpt: "e" })];
  const r = assessSufficiency("解释 x", ev);
  assert.equal(r.sufficient, true);
});

test("sufficiency: exact-fact question requires source evidence", () => {
  const wiki = [normalizeEvidence({ path: "wiki/concepts/x.md", excerpt: "e" })];
  const r1 = assessSufficiency("x 的版本号是多少", wiki, { exactFact: true });
  assert.equal(r1.sufficient, false);
  assert.equal(r1.level, "partial");
  const withSource = [...wiki, normalizeEvidence({ path: "Sources/x.md", excerpt: "v1.2" })];
  const r2 = assessSufficiency("x 的版本号是多少", withSource, { exactFact: true });
  assert.equal(r2.sufficient, true);
});
