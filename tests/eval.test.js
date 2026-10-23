// Unit tests for S1 eval scoring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCase, recallAt10, citationAccuracy, noFabricationHonest } from '../src/search/eval.js';

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
