// Search CLI (P4 /知识检索): classify intent, retrieve, show evidence.
// Usage: OBSIDIAN_API_KEY=... node scripts/search-cli.mjs <query>

import { ObsidianClient, ObsidianAdapter } from "../src/obsidian/obsidian-adapter.js";
import { SearchRetriever } from "../src/search/retriever.js";
import { classifyIntent, INTENT } from "../src/search/intent.js";
import { assessSufficiency } from "../src/search/evidence.js";

const apiKey = process.env.OBSIDIAN_API_KEY;
// Trim before the empty check so a whitespace-only query is rejected instead
// of running a meaningless retrieval.
const query = process.argv.slice(2).join(" ").trim();
if (!apiKey || !query) {
  console.error("usage: OBSIDIAN_API_KEY=... node scripts/search-cli.mjs <query>");
  process.exit(1);
}

const client = new ObsidianClient({ baseUrl: "https://127.0.0.1:27124", apiKey });
const adapter = new ObsidianAdapter(client);
const retriever = new SearchRetriever({ adapter });
const intent = classifyIntent(query);
console.log("intent:", intent);

if (intent === INTENT.structure) {
  const structural = await retriever.structural(query);
  console.log("structural:", JSON.stringify(structural, null, 2));
  process.exit(0);
}

const results = await retriever.wikiFirst(query);
const sufficiency = assessSufficiency(query, results, { exactFact: intent === INTENT.source });
console.log("sufficiency:", JSON.stringify(sufficiency, null, 2));
console.log("results:", JSON.stringify(results, null, 2));
process.exit(0);
