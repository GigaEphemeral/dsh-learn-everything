// S1 evaluation scoring: per-case metrics behind the acceptance gates.
// Recall@10 (expected evidence surfaces in the top-10), citation accuracy
// (expected paths are among the cited paths), and no-fabrication honesty
// (no-answer cases must not come back "supported"). Pure functions so the
// scoring is unit-testable without a vault.

function norm(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

// Does one normalized path match an expected path (either contains the other)?
function pathMatches(have, expected) {
  return have.includes(expected) || expected.includes(have);
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

export function evaluateCase({ results = [], sufficiency = { level: "none" }, citedPaths = [] }, expectation) {
  const expectedPaths = expectation.expectEvidence ?? [];
  const expectNone = expectation.expectNone === true;
  return {
    recallAt10: recallAt10(results, expectedPaths),
    citationAccuracy: citationAccuracy(citedPaths, expectedPaths),
    honest: noFabricationHonest(sufficiency, expectNone),
  };
}
