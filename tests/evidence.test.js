// Unit tests for the S1 evidence model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GAP_MESSAGES, normalizeEvidence, assessSufficiency } from "../src/search/evidence.js";

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

test("normalizeEvidence rejects a missing or malformed path (E1)", () => {
  for (const path of [undefined, null, "", "   ", 42, {}, ["x"]]) {
    assert.throws(
      () => normalizeEvidence({ path, excerpt: "e" }),
      (err) => err instanceof TypeError && /path must be a non-empty string/.test(err.message),
    );
  }
});

test("normalizeEvidence classifies case- and separator-insensitively (E2)", () => {
  const type = (path) => normalizeEvidence({ path, excerpt: "e" }).resultType;
  assert.equal(type("Wiki/concepts/X.md"), "wiki_page");
  assert.equal(type("wiki\\concepts\\X.md"), "wiki_page");
  assert.equal(type("/wiki/x.md"), "wiki_page");
  assert.equal(type("Sources/x.md"), "source_note");
  assert.equal(type("sources/x.md"), "source_note");
  assert.equal(type("Inbox/x.md"), "source_note");
  assert.equal(type("inbox\\x.md"), "source_note");
  // The original spelling is preserved for citations, and titles keep their case.
  const win = normalizeEvidence({ path: "wiki\\concepts\\Transformer.md", excerpt: "e" });
  assert.equal(win.path, "wiki\\concepts\\Transformer.md");
  assert.equal(win.title, "Transformer");
});

test("normalizeEvidence derives sourceNote from the resolved resultType (E3)", () => {
  const forcedPlain = normalizeEvidence({ path: "Sources/x.md", excerpt: "e", resultType: "search_result" });
  assert.equal(forcedPlain.resultType, "search_result");
  assert.equal(forcedPlain.sourceNote, null);
  const forcedSource = normalizeEvidence({ path: "notes/y.md", excerpt: "e", resultType: "source_note" });
  assert.equal(forcedSource.sourceNote, "notes/y.md");
  const forcedWiki = normalizeEvidence({ path: "Sources/z.md", excerpt: "e", resultType: "wiki_page" });
  assert.equal(forcedWiki.sourceNote, null);
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

test("sufficiency requires at least one non-empty excerpt (E4)", () => {
  const empty = [
    normalizeEvidence({ path: "wiki/concepts/x.md", excerpt: "" }),
    normalizeEvidence({ path: "Sources/x.md", excerpt: "   " }),
    normalizeEvidence({ path: "wiki/concepts/y.md" }),
  ];
  const emptyResult = assessSufficiency("解释 x", empty);
  assert.equal(emptyResult.sufficient, false);
  assert.equal(emptyResult.level, "partial");
  const mixed = [...empty, normalizeEvidence({ path: "wiki/concepts/z.md", excerpt: "real" })];
  assert.equal(assessSufficiency("解释 x", mixed).sufficient, true);
  // An excerpt-less source cannot satisfy an exact-fact question either.
  const exact = assessSufficiency(
    "x 的版本号是多少",
    [normalizeEvidence({ path: "Sources/x.md", excerpt: " " })],
    { exactFact: true },
  );
  assert.equal(exact.sufficient, false);
});

test("sufficiency gaps expose stable codes with messages (E5)", () => {
  const wikiNoExcerpt = [normalizeEvidence({ path: "wiki/concepts/x.md", excerpt: "" })];
  const wikiOnly = [normalizeEvidence({ path: "wiki/concepts/x.md", excerpt: "e" })];
  const plainOnly = [normalizeEvidence({ path: "notes/x.md", excerpt: "e" })];
  assert.deepEqual(assessSufficiency("问题", []).gaps, [
    { code: "no_evidence", message: GAP_MESSAGES.no_evidence },
  ]);
  assert.deepEqual(assessSufficiency("解释 x", wikiNoExcerpt).gaps, [
    { code: "no_excerpt", message: GAP_MESSAGES.no_excerpt },
  ]);
  assert.deepEqual(assessSufficiency("x 的版本号", wikiOnly, { exactFact: true }).gaps, [
    { code: "exact_fact_needs_source", message: GAP_MESSAGES.exact_fact_needs_source },
  ]);
  assert.deepEqual(assessSufficiency("x", plainOnly).gaps, [
    { code: "no_verified_source", message: GAP_MESSAGES.no_verified_source },
  ]);
  assert.deepEqual(Object.keys(GAP_MESSAGES).sort(), [
    "exact_fact_needs_source",
    "no_evidence",
    "no_excerpt",
    "no_verified_source",
  ]);
});
