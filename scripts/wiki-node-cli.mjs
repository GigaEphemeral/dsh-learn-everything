// Wiki node helper for the daily-practice skill: pick a random knowledge node
// from the compiled wiki, or show one node's content + its source notes.
// Usage:
//   OBSIDIAN_API_KEY=... node scripts/wiki-node-cli.mjs random
//   OBSIDIAN_API_KEY=... node scripts/wiki-node-cli.mjs show <concept-name>
//
// Output is always JSON. Errors are printed as {"error": "..."} with a
// non-zero exit code, so the skill can parse one shape and a shell `set -e`
// flow still fails.

import { pathToFileURL } from "node:url";
import { ObsidianClient, ObsidianAdapter, ObsidianError } from "../src/obsidian/obsidian-adapter.js";

const BASE_URL = "https://127.0.0.1:27124";
const WIKI_DIRS = ["wiki/concepts", "wiki/entities", "wiki/sources"];
const MAX_CONTENT_CHARS = 2000;

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

// Extract the source note path from a wiki page's frontmatter. Accepted shapes:
//   source_file: "[[Sources/foo.md]]"          (double quotes)
//   source_file: '[[Sources/foo.md|Alias]]'    (single quotes + alias)
//   source_file: [[Sources/foo.md]] # comment  (unquoted + trailing comment)
export function extractSourceFile(content) {
  if (typeof content !== "string") return null;
  const line = content.match(/^source_file:\s*(.+)$/m)?.[1];
  if (!line) return null;
  const link = line.match(/\[\[([^\]\n]+?)\]\]/)?.[1];
  if (!link) return null;
  // Drop an Obsidian alias (`[[path|alias]]`) and surrounding whitespace.
  const sourcePath = link.split("|")[0].trim();
  return sourcePath === "" ? null : sourcePath;
}

// List a wiki directory. Only a 404 means "this directory has no pages yet";
// any other error (auth, TLS, timeout, 5xx) must surface instead of showing an
// empty wiki.
export async function listDir(adapter, dir) {
  try {
    const { files } = await adapter.list(dir);
    return files ?? [];
  } catch (err) {
    if (err instanceof ObsidianError && err.status === 404) return [];
    throw new Error(`failed to list "${dir}" in the wiki: ${errorMessage(err)}`, { cause: err });
  }
}

export async function collectNodes(adapter) {
  const nodes = [];
  for (const dir of WIKI_DIRS) {
    const files = await listDir(adapter, dir);
    for (const file of files) {
      nodes.push({ dir, file, path: `${dir}/${file}` });
    }
  }
  return nodes;
}

function nodeName(file) {
  return file.replace(/\.md$/i, "");
}

function nodeType(node) {
  return node.dir.split("/")[1];
}

// Read a node's Markdown body. The REST API returns no body for a failed/empty
// read, so a non-string response is an error rather than something to call
// .match()/.slice() on.
export async function readNode(adapter, path) {
  let content;
  try {
    content = await adapter.read(path);
  } catch (err) {
    throw new Error(`failed to read "${path}": ${errorMessage(err)}`, { cause: err });
  }
  if (typeof content !== "string") {
    throw new Error(`unexpected response for "${path}": expected Markdown text, got ${typeof content}`);
  }
  return content;
}

export async function randomNode(adapter) {
  const nodes = await collectNodes(adapter);
  if (nodes.length === 0) {
    throw new Error("wiki is empty; ingest sources first");
  }
  const pick = nodes[Math.floor(Math.random() * nodes.length)];
  const content = await readNode(adapter, pick.path);
  return {
    keyword: nodeName(pick.file),
    type: nodeType(pick),
    path: pick.path,
    sourceFile: extractSourceFile(content),
    content: content.slice(0, MAX_CONTENT_CHARS),
    // Signal that the downstream LLM is looking at a partial page.
    truncated: content.length > MAX_CONTENT_CHARS,
  };
}

export async function showNode(adapter, name) {
  const nodes = await collectNodes(adapter);
  const match = nodes.find((node) => nodeName(node.file) === name || node.file === name);
  if (!match) {
    throw new Error(`node "${name}" not found`);
  }
  const content = await readNode(adapter, match.path);
  return {
    keyword: name,
    type: nodeType(match),
    path: match.path,
    content,
  };
}

function createAdapter(apiKey) {
  return new ObsidianAdapter(new ObsidianClient({ baseUrl: BASE_URL, apiKey }));
}

async function main() {
  const apiKey = process.env.OBSIDIAN_API_KEY;
  const [mode, name] = process.argv.slice(2);
  if (!apiKey || !mode) {
    console.error("usage: OBSIDIAN_API_KEY=... node scripts/wiki-node-cli.mjs <random|show> [name]");
    process.exitCode = 1;
    return;
  }
  if (mode === "show" && !name) {
    console.error("show needs a name");
    process.exitCode = 1;
    return;
  }
  if (mode !== "random" && mode !== "show") {
    console.error("unknown mode; use random|show");
    process.exitCode = 1;
    return;
  }

  const adapter = createAdapter(apiKey);
  try {
    const payload = mode === "random" ? await randomNode(adapter) : await showNode(adapter, name);
    console.log(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ error: errorMessage(err) }));
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
