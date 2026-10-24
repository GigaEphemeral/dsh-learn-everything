// S1 search evaluation runner: runs the eval set against the live vault and
// reports the acceptance metrics (Recall@10, citation accuracy, honesty).
// Usage: OBSIDIAN_API_KEY=... node scripts/search-eval.mjs [eval-set.json]

import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ObsidianClient, ObsidianAdapter } from "../src/obsidian/obsidian-adapter.js";
import { SearchRetriever } from "../src/search/retriever.js";
import { classifyIntent, INTENT } from "../src/search/intent.js";
import { assessSufficiency } from "../src/search/evidence.js";
import { evaluateCase, honestyRate } from '../src/search/eval.js';

const BASE_URL = process.env.OBSIDIAN_BASE_URL ?? "https://127.0.0.1:27124";

function emptyBucket() {
  return { total: 0, recallSum: 0, citSum: 0, recallN: 0, citN: 0, noneTotal: 0, noneHonest: 0 };
}

// Structural items carry full vault paths; keep bare strings usable too.
function structuralResults(structural) {
  return (structural.items || []).map((item) =>
    typeof item === "string" ? { path: item } : { path: item.path });
}

async function main() {
  const apiKey = process.env.OBSIDIAN_API_KEY;
  if (!apiKey) {
    console.error("usage: OBSIDIAN_API_KEY=... node scripts/search-eval.mjs");
    process.exitCode = 1;
    return;
  }
  const setFile = process.argv[2] ?? fileURLToPath(new URL("../tests/eval-set.json", import.meta.url));
  const set = JSON.parse(await readFile(setFile, "utf8"));
  if (!Array.isArray(set.cases)) {
    console.error("search-eval: eval set has no cases array");
    process.exitCode = 1;
    return;
  }
  const client = new ObsidianClient({ baseUrl: BASE_URL, apiKey });
  const adapter = new ObsidianAdapter(client);
  const retriever = new SearchRetriever({ adapter });
  const active = set.cases.filter((c) => c.status === "active");
  let recallSum = 0, citSum = 0, recallN = 0, citN = 0;
  const honestyEntries = [];
  const failures = [];
  const underRecall = [];
  const byCategory = {};
  for (const c of active) {
    try {
      const intent = classifyIntent(c.query);
      const results = intent === INTENT.structure
        ? structuralResults(await retriever.structural(c.query))
        : await retriever.wikiFirst(c.query);
      const sufficiency = assessSufficiency(c.query, results, { exactFact: intent === INTENT.source });
      const cited = results.slice(0, 5).map((r) => r.path);
      const score = evaluateCase({ results, sufficiency, citedPaths: cited }, c);
      const cat = byCategory[c.category] ?? (byCategory[c.category] = emptyBucket());
      cat.total += 1;
      if (score.recallAt10 !== null) { cat.recallSum += score.recallAt10; cat.recallN += 1; }
      if (score.citationAccuracy !== null) { cat.citSum += score.citationAccuracy; cat.citN += 1; }
      if (c.expectNone === true) {
        honestyEntries.push({ expectNone: true, honest: score.honest });
        cat.noneTotal += 1;
        if (score.honest) cat.noneHonest += 1;
      }
      if (score.recallAt10 !== null) { recallSum += score.recallAt10; recallN += 1; }
      if (score.citationAccuracy !== null) { citSum += score.citationAccuracy; citN += 1; }
      if (score.recallAt10 !== null && score.recallAt10 < 1) {
        underRecall.push({ q: c.query, cat: c.category, recall: score.recallAt10, top: results.slice(0, 3).map((r) => r.path) });
      }
    } catch (error) {
      // One failing case must not discard every other case's report.
      failures.push({ q: c.query, cat: c.category, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const honesty = honestyRate(honestyEntries);
  const report = {
    domain: set.domain,
    activeCases: active.length,
    failedCases: failures.length,
    metrics: {
      recallAt10: recallN ? Number((recallSum / recallN).toFixed(3)) : null,
      citationAccuracy: citN ? Number((citSum / citN).toFixed(3)) : null,
      honesty: honesty === null ? null : Number(honesty.toFixed(3)),
    },
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, {
      total: v.total,
      recallAt10: v.recallN ? Number((v.recallSum / v.recallN).toFixed(3)) : null,
      citationAccuracy: v.citN ? Number((v.citSum / v.citN).toFixed(3)) : null,
      honesty: v.noneTotal ? Number((v.noneHonest / v.noneTotal).toFixed(3)) : null,
    }])),
    failures,
    underRecall: underRecall.slice(0, 10),
  };
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error("search-eval: " + (err instanceof Error ? err.message : String(err))); process.exitCode = 1; });
}
