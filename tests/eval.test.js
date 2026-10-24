// Unit tests for S1 eval scoring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCase, recallAt10, citationAccuracy, noFabricationHonest, honestyRate } from '../src/search/eval.js';

test("recallAt10 counts expected paths among the top-10 results", () => {
  const results = [
    { path: 'wiki/concepts/dsh-bundle-patch.md' },
    { path: 'Sources/dsh-plugin-dev-patterns.md' },
  ];
  assert.equal(recallAt10(results, ["Sources/dsh-plugin-dev-patterns.md"]), 1);
  assert.equal(recallAt10(results, ["Sources/missing.md"]), 0);
  assert.equal(recallAt10(results, []), null);
});

test("citationAccuracy requires the expected paths to be cited", () => {
  assert.equal(citationAccuracy(["Sources/dsh-plugin-dev-patterns.md"], ["Sources/dsh-plugin-dev-patterns.md"]), 1);
  assert.equal(citationAccuracy(["wiki/x.md"], ["Sources/dsh-plugin-dev-patterns.md"]), 0);
  assert.equal(citationAccuracy([], ["Sources/x.md"]), 0);
});

test("no-answer cases are honest only when sufficiency is not supported", () => {
  assert.equal(noFabricationHonest({ level: "none" }, true), true);
  assert.equal(noFabricationHonest({ level: "partial" }, true), true);
  assert.equal(noFabricationHonest({ level: "supported" }, true), false);
  assert.equal(noFabricationHonest({ level: "none" }, false), true);
});

test("evaluateCase combines the three metrics", () => {
  const e = evaluateCase(
    {
      results: [{ path: 'Sources/dsh-plugin-dev-patterns.md' }],
      sufficiency: { level: "supported" },
      citedPaths: ['Sources/dsh-plugin-dev-patterns.md'],
    },
    { expectEvidence: ['Sources/dsh-plugin-dev-patterns.md'] },
  );
  assert.equal(e.recallAt10, 1);
  assert.equal(e.citationAccuracy, 1);
  assert.equal(e.honest, true);
});

test("path matching is exact or directory-prefix, not substring", () => {
  assert.equal(recallAt10([{ path: 'dsh-bundle-patch.md' }], ['wiki/concepts/dsh-bundle-patch.md']), 0);
  assert.equal(recallAt10([{ path: 'wiki/concepts/a.md' }], ['wiki/concepts']), 1);
  assert.equal(recallAt10([{ path: 'wiki/concepts.md' }], ['wiki/concepts']), 0);
  assert.equal(recallAt10([{ path: 'anything.md' }], ['']), 0);
});

test("honestyRate only counts no-answer cases", () => {
  assert.equal(honestyRate([
    { expectNone: true, honest: false },
    { expectNone: true, honest: true },
    { expectNone: false, honest: true },
  ]), 0.5);
  assert.equal(honestyRate([{ expectNone: false, honest: true }]), null);
});
