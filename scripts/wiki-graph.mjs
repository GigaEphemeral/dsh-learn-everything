// Wiki graph CLI (S4): extract the [[link]] graph from the compiled wiki and
// print it as JSON (for the DSH panel graph page).
// Usage: OBSIDIAN_API_KEY=... node scripts/wiki-graph.mjs [--out code/.state/wiki-graph.json]
import { writeFile } from "node:fs/promises";
import { ObsidianClient, ObsidianAdapter, ObsidianError } from "../src/obsidian/obsidian-adapter.js";
import { buildGraph } from "../src/wiki/graph.js";

const BASE_URL = process.env.OBSIDIAN_BASE_URL ?? "https://127.0.0.1:27124";
const WIKI_DIRS = ["wiki/concepts", "wiki/entities", "wiki/sources"];

async function main() {
  const apiKey = process.env.OBSIDIAN_API_KEY;
  if (!apiKey) {
    console.error("usage: OBSIDIAN_API_KEY=... node scripts/wiki-graph.mjs [--out <path>]");
    process.exitCode = 1;
    return;
  }
  const adapter = new ObsidianAdapter(new ObsidianClient({ baseUrl: BASE_URL, apiKey }));
  const pages = [];
  for (const dir of WIKI_DIRS) {
    let files = [];
    try {
      const res = await adapter.list(dir);
      files = res?.files ?? [];
    } catch (err) {
      if (err instanceof ObsidianError && err.status === 404) files = [];
      else throw err;
    }
    for (const file of files) {
      const path = dir + "/" + file;
      const content = await adapter.read(path);
      if (typeof content === "string") pages.push({ path, content });
    }
  }
  const graph = buildGraph(pages);
  const outIdx = process.argv.indexOf("--out");
  if (outIdx >= 0 && process.argv[outIdx + 1]) {
    await writeFile(process.argv[outIdx + 1], JSON.stringify(graph, null, 2) + "\n");
    console.log("graph written:", process.argv[outIdx + 1], "| nodes:", graph.nodes.length, "edges:", graph.edges.length);
  } else {
    console.log(JSON.stringify(graph, null, 2));
  }
}

import { pathToFileURL } from "node:url";
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error("wiki-graph: " + (err instanceof Error ? err.message : String(err))); process.exitCode = 1; });
}
