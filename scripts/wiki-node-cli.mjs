// Wiki node helper for the daily-practice skill: pick a random knowledge node
// from the compiled wiki, or show one node's content + its source notes.
// Usage:
//   OBSIDIAN_API_KEY=... node scripts/wiki-node-cli.mjs random
//   OBSIDIAN_API_KEY=... node scripts/wiki-node-cli.mjs show <concept-name>

import { ObsidianClient, ObsidianAdapter } from "../src/obsidian/obsidian-adapter.js";

const apiKey = process.env.OBSIDIAN_API_KEY;
const mode = process.argv[2];
const arg = process.argv[3];
if (!apiKey || !mode) {
  console.error("usage: OBSIDIAN_API_KEY=... node scripts/wiki-node-cli.mjs <random|show> [name]");
  process.exit(1);
}

const client = new ObsidianClient({ baseUrl: "https://127.0.0.1:27124", apiKey });
const adapter = new ObsidianAdapter(client);

async function listDir(dir) {
  try {
    const { files } = await adapter.list(dir);
    return files ?? [];
  } catch {
    return [];
  }
}

// Collect all wiki pages (concepts/entities/sources) with their dir.
async function allNodes() {
  const nodes = [];
  for (const dir of ["wiki/concepts", "wiki/entities", "wiki/sources"]) {
    for (const f of await listDir(dir)) {
      nodes.push({ dir, file: f, path: `${dir}/${f}` });
    }
  }
  return nodes;
}

if (mode === "random") {
  const nodes = await allNodes();
  if (nodes.length === 0) {
    console.log(JSON.stringify({ error: "wiki is empty; ingest sources first" }));
    process.exit(1);
  }
  const pick = nodes[Math.floor(Math.random() * nodes.length)];
  const content = await adapter.read(pick.path);
  const title = pick.file.replace(/\.md$/, "");
  // Extract the source note links if this is a source page.
  const sourceFile = content.match(/source_file:\s*\"?\[\[([^\]]+)\]\]/)?.[1] ?? null;
  console.log(JSON.stringify({
    keyword: title,
    type: pick.dir.split("/")[1],
    path: pick.path,
    sourceFile,
    content: content.slice(0, 2000),
  }, null, 2));
  process.exit(0);
}

if (mode === "show") {
  if (!arg) {
    console.error("show needs a name");
    process.exit(1);
  }
  const nodes = await allNodes();
  const match = nodes.find((n) => n.file.replace(/\.md$/, "") === arg || n.file === arg);
  if (!match) {
    console.log(JSON.stringify({ error: `node "${arg}" not found` }));
    process.exit(1);
  }
  const content = await adapter.read(match.path);
  console.log(JSON.stringify({ keyword: arg, type: match.dir.split("/")[1], path: match.path, content }, null, 2));
  process.exit(0);
}

console.error("unknown mode; use random|show");
process.exit(1);
