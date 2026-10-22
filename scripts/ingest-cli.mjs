// Ingest CLI (P3 /记住知识): fetch a source, preflight, confirm, write,
// compile via karpathywiki, report. Confirmation is read from stdin so the
// flow honors the no-write-without-confirmation gate headlessly.
//
// Usage:
//   OBSIDIAN_API_KEY=... node scripts/ingest-cli.mjs <https-url>
//   OBSIDIAN_API_KEY=... node scripts/ingest-cli.mjs <local-markdown-path>
//   OBSIDIAN_API_KEY=... node scripts/ingest-cli.mjs <local-markdown-path> --auto-yes

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ObsidianClient, ObsidianAdapter } from "../src/obsidian/obsidian-adapter.js";
import { McpClient } from "../src/obsidian/mcp-client.js";
import { KarpathyDriver } from "../src/wiki/karpathy-driver.js";
import { SourceRegistry } from "../src/ingest/registry.js";
import { IngestPipeline } from "../src/ingest/pipeline.js";
import { IngestTask } from "../src/ingest/task-state.js";
import { fetchUrl, readLocalFile, normalizeSource } from "../src/ingest/source-fetch.js";

const apiKey = process.env.OBSIDIAN_API_KEY;
const target = process.argv[2];
const autoYes = process.argv.includes("--auto-yes");
// State dir resolves relative to this script (code/scripts -> code/.state),
if (!apiKey || !target) {
  console.error("usage: OBSIDIAN_API_KEY=... node scripts/ingest-cli.mjs <url|local-md> [--auto-yes]");
  process.exit(1);
}

// Load a source from a URL or a local Markdown file.
async function acquire(target) {
  if (/^https?:\/\//.test(target)) {
    const content = await fetchUrl(target);
    return normalizeSource({ sourceUri: target, title: undefined, content });
  }
  const content = await readLocalFile(target);
  const title = target.split("/").pop().replace(/\.md$/i, "");
  return normalizeSource({ sourceUri: `file://${target}`, title, content });
}

const baseUrl = "https://127.0.0.1:27124";
const client = new ObsidianClient({ baseUrl, apiKey });
const adapter = new ObsidianAdapter(client);
const mcp = new McpClient({ baseUrl, apiKey });
const driver = new KarpathyDriver({ adapter, mcp });
const registry = await new SourceRegistry({ filePath: join(stateDir, "sources.json") }).load();

const source = await acquire(target);
console.log("source:", JSON.stringify({ title: source.title, uri: source.sourceUri, hash: source.contentHash.slice(0, 16) }, null, 2));

// Confirmation callback: prompt on stdin unless --auto-yes.
function confirm(prompt) {
  if (autoYes) {
    console.log("[confirm auto-yes]", prompt.split("\n")[0]);
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    process.stdout.write(prompt + "\n[y/N] ");
    process.stdin.once("data", (d) => {
      const v = d.toString().trim().toLowerCase();
      resolve(v === "y" || v === "yes");
    });
  });
}

const task = new IngestTask({ taskId: `ingest-${Date.now()}`, source });
const pipeline = new IngestPipeline({ adapter, registry, driver, task });
const report = await pipeline.run({ source, confirm });
console.log("\nreport:", JSON.stringify(report, null, 2));
process.exit(report.status === "completed" ? 0 : 2);
