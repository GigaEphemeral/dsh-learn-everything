// Wiki node helper for the daily-practice skill: pick a random knowledge node
// from the compiled wiki, or show one node's content + its source notes.
// Usage:
//   OBSIDIAN_API_KEY=... node scripts/wiki-node-cli.mjs random
//   OBSIDIAN_API_KEY=... node scripts/wiki-node-cli.mjs show <concept-name>
//
// Vault layout: the wiki directories default to the compiled KarpathyWiki
// layout and can be overridden with a comma-separated OBSIDIAN_WIKI_DIRS.
//
// Output is always JSON. Errors are printed as {"error": "..."} with a
// non-zero exit code, so the skill can parse one shape and a shell `set -e`
// flow still fails.

import { pathToFileURL } from "node:url";
import { ObsidianClient, ObsidianAdapter, ObsidianError } from "../src/obsidian/obsidian-adapter.js";

const BASE_URL = "https://127.0.0.1:27124";
const MAX_CONTENT_CHARS = 2000;

// The wiki is compiled into these directories. OBSIDIAN_WIKI_DIRS overrides the
// layout with a comma-separated list so a differently organised vault needs no
// code change; the declared order also drives deterministic node enumeration.
export const DEFAULT_WIKI_DIRS = ["wiki/concepts", "wiki/entities", "wiki/sources"];

export function parseWikiDirs(raw) {
  if (typeof raw !== "string") return [...DEFAULT_WIKI_DIRS];
  const dirs = raw
    .split(",")
    .map((dir) => dir.trim())
    .filter((dir) => dir !== "");
  // A blank/whitespace-only override is a typo rather than "no wiki dirs at
  // all", so fall back to the default; duplicates are collapsed but the
  // first-seen order is kept.
  return [...new Set(dirs.length === 0 ? DEFAULT_WIKI_DIRS : dirs)];
}

export const WIKI_DIRS = parseWikiDirs(process.env.OBSIDIAN_WIKI_DIRS);

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

// Enumerate every wiki directory in parallel, then flatten in WIKI_DIRS order
// (not in completion order) so the node list — and the random pick derived from
// it — stays stable regardless of which request finishes first.
export async function collectNodes(adapter) {
  const listings = await Promise.all(WIKI_DIRS.map((dir) => listDir(adapter, dir)));
  const nodes = [];
  listings.forEach((files, index) => {
    const dir = WIKI_DIRS[index];
    for (const file of files) {
      nodes.push({ dir, file, path: `${dir}/${file}` });
    }
  });
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

// Shared read path for both modes: read errors and non-string bodies surface
// identically, and both modes get the same truncation/source metadata.
export async function loadNode(adapter, node) {
  const content = await readNode(adapter, node.path);
  return {
    content: content.slice(0, MAX_CONTENT_CHARS),
    truncated: content.length > MAX_CONTENT_CHARS,
    sourceFile: extractSourceFile(content),
  };
}

// One JSON shape for both modes. `keyword` is the file stem for a random node
// and the requested name for an explicit lookup, so a caller can parse a single
// shape and still know which node it got.
function emitNode(node, keyword, loaded) {
  return {
    keyword,
    type: nodeType(node),
    path: node.path,
    sourceFile: loaded.sourceFile,
    content: loaded.content,
    truncated: loaded.truncated,
  };
}

export async function randomNode(adapter) {
  const nodes = await collectNodes(adapter);
  if (nodes.length === 0) {
    throw new Error("wiki is empty; ingest sources first");
  }
  const pick = nodes[Math.floor(Math.random() * nodes.length)];
  return emitNode(pick, nodeName(pick.file), await loadNode(adapter, pick));
}

export async function showNode(adapter, name) {
  const nodes = await collectNodes(adapter);
  const match = nodes.find((node) => nodeName(node.file) === name || node.file === name);
  if (!match) {
    throw new Error(`node "${name}" not found`);
  }
  return emitNode(match, name, await loadNode(adapter, match));
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
