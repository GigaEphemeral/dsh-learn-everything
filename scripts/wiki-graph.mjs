// Wiki graph CLI (S4): extract the [[link]] graph from the compiled wiki and
// print it as JSON (for the DSH panel graph page).
// Usage: OBSIDIAN_API_KEY=... node scripts/wiki-graph.mjs [--out code/.state/wiki-graph.json]
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { ObsidianClient, ObsidianAdapter, ObsidianError } from "../src/obsidian/obsidian-adapter.js";
import { buildGraph } from "../src/wiki/graph.js";
import { WIKI_DIRS } from "../src/wiki/karpathy-driver.js";

const BASE_URL = process.env.OBSIDIAN_BASE_URL ?? "https://127.0.0.1:27124";

// Read every wiki directory, then its pages with bounded concurrency. A
// missing directory or unreadable page is skipped, like the panel graph.
export async function collectGraph(adapter, dirs = WIKI_DIRS) {
  const paths = [];
  for (const dir of dirs) {
    try {
      const res = await adapter.list(dir);
      for (const file of res?.files ?? []) paths.push(dir + "/" + file);
    } catch (err) {
      if (err instanceof ObsidianError && err.status === 404) continue;
      throw err;
    }
  }
  const pages = [];
  const concurrency = 8;
  for (let start = 0; start < paths.length; start += concurrency) {
    const batch = paths.slice(start, start + concurrency);
    const contents = await Promise.all(batch.map(async (path) => {
      try {
        return { path, content: await adapter.read(path) };
      } catch (err) {
        if (err instanceof ObsidianError) return null;
        throw err;
      }
    }));
    for (const page of contents) if (page && typeof page.content === "string") pages.push(page);
  }
  return buildGraph(pages);
}

async function main() {
  const apiKey = process.env.OBSIDIAN_API_KEY;
  if (!apiKey) {
    console.error("usage: OBSIDIAN_API_KEY=... node scripts/wiki-graph.mjs [--out <path>]");
    process.exitCode = 1;
    return;
  }
  const adapter = new ObsidianAdapter(new ObsidianClient({ baseUrl: BASE_URL, apiKey }));
  const graph = await collectGraph(adapter);
  const outIdx = process.argv.indexOf("--out");
  if (outIdx >= 0 && process.argv[outIdx + 1]) {
    const target = process.argv[outIdx + 1];
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(graph, null, 2) + "\n");
    console.log("graph written:", target, "| nodes:", graph.nodes.length, "edges:", graph.edges.length);
  } else {
    console.log(JSON.stringify(graph, null, 2));
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error("wiki-graph: " + (err instanceof Error ? err.message : String(err))); process.exitCode = 1; });
}
