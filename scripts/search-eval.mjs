// S1 search evaluation runner: runs the eval set against the live vault and
// reports the acceptance metrics (Recall@10, citation accuracy, honesty).
// Usage: OBSIDIAN_API_KEY=... node scripts/search-eval.mjs [eval-set.json]

import { readFile } from "node:fs/promises";
import { ObsidianClient, ObsidianAdapter } from "../src/obsidian/obsidian-adapter.js";
import { SearchRetriever } from "../src/search/retriever.js";
import { classifyIntent, INTENT } from "../src/search/intent.js";
import { assessSufficiency } from "../src/search/evidence.js";
import { evaluateCase } from '../src/search/eval.js';

const BASE_URL = process.env.OBSIDIAN_BASE_URL ?? "https://127.0.0.1:27124";

async function main() {
  const apiKey = process.env.OBSIDIAN_API_KEY;
  if (!apiKey) {
    console.error("usage: OBSIDIAN_API_KEY=... node scripts/search-eval.mjs");
    process.exitCode = 1;
    return;
  }
  const setFile = process.argv[2] ?? new URL("../tests/eval-set.json", import.meta.url).pathname;
  const set = JSON.parse(await readFile(setFile, "utf8"));
  const client = new ObsidianClient({ baseUrl: BASE_URL, apiKey });
  const adapter = new ObsidianAdapter(client);
  const retriever = new SearchRetriever({ adapter });
  const active = set.cases.filter((c) => c.status === "active");
  let recallSum = 0, citSum = 0, recallN = 0, citN = 0, honest = 0, fail = [];
  const byCategory = {};
  for (const c of active) {
    const intent = classifyIntent(c.query);
    let results = [];
    if (intent === INTENT.structure) {
      const structural = await retriever.structural(c.query);
      const dir = structural.dir ? structural.dir + "/" : "";
      results = (structural.items || []).map((item) => ({ path: dir + item }));
    } else {
      results = await retriever.wikiFirst(c.query);
    }
    const sufficiency = assessSufficiency(c.query, results, { exactFact: intent === INTENT.source });
    const cited = results.slice(0, 5).map((r) => r.path);
    const score = evaluateCase({ results, sufficiency, citedPaths: cited }, c);
    byCategory[c.category] = byCategory[c.category] ?? { total: 0, recallSum: 0, citSum: 0, recallN: 0, citN: 0, honest: 0 };
    const cat = byCategory[c.category];
    cat.total += 1;
    if (score.recallAt10 !== null) { cat.recallSum += score.recallAt10; cat.recallN += 1; }
    if (score.citationAccuracy !== null) { cat.citSum += score.citationAccuracy; cat.citN += 1; }
    if (score.honest) cat.honest += 1;
    if (score.recallAt10 !== null) { recallSum += score.recallAt10; recallN += 1; }
    if (score.citationAccuracy !== null) { citSum += score.citationAccuracy; citN += 1; }
    if (score.honest) honest += 1;
    if (score.recallAt10 !== null && score.recallAt10 < 1) fail.push({ q: c.query, cat: c.category, recall: score.recallAt10, top: results.slice(0, 3).map((r) => r.path) });
  }
  const report = {
    domain: set.domain,
    activeCases: active.length,
    metrics: {
      recallAt10: recallN ? Number((recallSum / recallN).toFixed(3)) : null,
      citationAccuracy: citN ? Number((citSum / citN).toFixed(3)) : null,
      honesty: Number((honest / active.length).toFixed(3)),
    },
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, { total: v.total, recallAt10: v.recallN ? Number((v.recallSum / v.recallN).toFixed(3)) : null, citationAccuracy: v.citN ? Number((v.citSum / v.citN).toFixed(3)) : null, honest: v.total ? Number((v.honest / v.total).toFixed(3)) : null }])),
    underRecall: fail.slice(0, 10),
  };
  console.log(JSON.stringify(report, null, 2));
}

function flattenStructural(structural) {
  const out = [];
  const walk = (v) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v.path === "string") out.push({ path: v.path });
    Object.values(v).forEach(walk);
  };
  walk(structural);
  return out;
}

import { pathToFileURL } from "node:url";
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error("search-eval: " + (err instanceof Error ? err.message : String(err))); process.exitCode = 1; });
}
