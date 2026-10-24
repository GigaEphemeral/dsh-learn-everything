// S1 evaluation scoring: per-case metrics behind the acceptance gates.
// Recall@10 (expected evidence surfaces in the top-10), citation accuracy
// (expected paths are among the cited paths), and no-fabrication honesty
// (no-answer cases must not come back "supported"). Pure functions so the
// scoring is unit-testable without a vault.

function norm(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

// A result matches an expected path when it is that path or lives below an
// expected directory. Substring matching let `dsh-bundle-patch.md` satisfy
// `wiki/concepts/dsh-bundle-patch.md` and `wiki/concepts.md` satisfy the
// `wiki/concepts` folder, inflating recall/citation.
function pathMatches(have, expected) {
  if (!have || !expected) return false;
  return have === expected || have.startsWith(expected.endsWith("/") ? expected : expected + "/");
}

export function recallAt10(results, expectedPaths) {
  if (!expectedPaths.length) return null;
  const top = results.slice(0, 10).map((r) => norm(r.path)).filter(Boolean);
  const hits = expectedPaths.filter((p) => top.some((t) => pathMatches(t, norm(p))));
  return hits.length / expectedPaths.length;
}

export function citationAccuracy(citedPaths, expectedPaths) {
  if (!expectedPaths.length) return null;
  const cited = new Set(citedPaths.map(norm).filter(Boolean));
  const hits = expectedPaths.filter((p) => [...cited].some((c) => pathMatches(c, norm(p))));
  return hits.length / expectedPaths.length;
}

// A "no-answer" case passes honesty iff sufficiency is not supported.
export function noFabricationHonest(sufficiency, expectNone) {
  if (!expectNone) return true;
  return sufficiency.level === "none" || sufficiency.level === "partial";
}

// Honesty denominator is only the no-answer cases: treating every case as a
// potential no-answer made the metric look high even when all no-answer cases
// fabricated.
export function honestyRate(entries) {
  const noAnswer = entries.filter((entry) => entry.expectNone === true);
  if (noAnswer.length === 0) return null;
  return noAnswer.filter((entry) => entry.honest === true).length / noAnswer.length;
}

export function evaluateCase({ results = [], sufficiency = { level: "none" }, citedPaths = [] }, expectation) {
  const expectedPaths = expectation.expectEvidence ?? [];
  const expectNone = expectation.expectNone === true;
  return {
    recallAt10: recallAt10(results, expectedPaths),
    citationAccuracy: citationAccuracy(citedPaths, expectedPaths),
    honest: noFabricationHonest(sufficiency, expectNone),
  };
}
