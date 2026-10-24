// Compile CLI (S3, T3): explicitly trigger the karpathywiki compile for one
// source note (single trigger, no auto-retry), or list source notes that have
// not produced a wiki source page yet (pending). Aligns with the rate-limit
// finding: compile is slow (6-15min) and may be throttled by the backend, so
// it is never forced after ingest and never retried immediately.
//
// Usage:
//   OBSIDIAN_API_KEY=... node scripts/compile-cli.mjs <Sources/xxx.md>
//   OBSIDIAN_API_KEY=... node scripts/compile-cli.mjs pending
//
// Exit codes: 0 compiled / pending listed; 3 compile timed out (likely
// rate-limited, cool down); 1 usage/operational error.

import { pathToFileURL } from "node:url";
import { ObsidianClient, ObsidianAdapter, ObsidianError } from "../src/obsidian/obsidian-adapter.js";
import { McpClient } from "../src/obsidian/mcp-client.js";
import { KarpathyDriver, WikiIngestTimeoutError } from "../src/wiki/karpathy-driver.js";
import { appendCompileEvent, readCompileStatus } from "../src/obsidian/compile-status.js";
import { resolveStateDir } from "../src/ingest/state-dir.js";
import { join } from "node:path";

// Same documented OBSIDIAN_BASE_URL fallback as the other CLIs.
const BASE_URL = process.env.OBSIDIAN_BASE_URL ?? "https://127.0.0.1:27124";

// One status-file resolver for status, compile, and pending modes.
function statusFile() {
  return process.env.OBSIDIAN_COMPILE_STATUS
    ?? join(resolveStateDir(import.meta.url), "compile-status.json");
}

// Status bookkeeping must never turn a successful compile into an error.
export async function recordCompileEvent(filePath, event) {
  try {
    await appendCompileEvent(filePath, event);
  } catch (err) {
    console.warn(`compile-cli: could not record ${event.stage} status: ${errorMessage(err)}`);
  }
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

// A source note is compiled when a wiki/sources page exists whose name equals
// the slug or appends KarpathyWiki's hash suffix. The suffix must look like a
// hash: slugs may legally contain "_" (e.g. foo_bar), so a bare prefix match
// would hide the uncompiled foo when only foo_bar was compiled.
const COMPILED_SUFFIX = /^[0-9a-f]{6,}$/i;
const isMarkdown = (file) => /\.md$/i.test(file);
const withoutExtension = (file) => file.replace(/\.md$/i, "");

function isCompiled(slug, wikiName) {
  if (wikiName === slug) return true;
  if (!wikiName.startsWith(slug + "_")) return false;
  return COMPILED_SUFFIX.test(wikiName.slice(slug.length + 1));
}

export async function pendingSources(adapter, sourcesDir = "Sources", wikiSourcesDir = "wiki/sources") {
  const list = async (dir) => {
    try {
      const { files } = await adapter.list(dir);
      return files ?? [];
    } catch (err) {
      if (err instanceof ObsidianError && err.status === 404) return [];
      throw err;
    }
  };
  const [sources, wikiPages] = await Promise.all([list(sourcesDir), list(wikiSourcesDir)]);
  const wikiNames = wikiPages.filter(isMarkdown).map(withoutExtension);
  // Emit full source paths so the pending list chains directly into the compile
  // mode (which takes Sources/xxx.md), instead of bare slugs.
  return sources
    .filter(isMarkdown)
    .filter((file) => !wikiNames.some((wikiName) => isCompiled(withoutExtension(file), wikiName)))
    .map((file) => `${sourcesDir}/${file}`);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: OBSIDIAN_API_KEY=... node scripts/compile-cli.mjs <Sources/xxx.md|pending|status>");
    process.exitCode = 1;
    return;
  }
  // Status reads only a local file: it must work without an API key and
  // must not construct an Obsidian client.
  if (arg === "status") {
    const s = await readCompileStatus(statusFile());
    console.log(JSON.stringify(s, null, 2));
    return;
  }
  const apiKey = process.env.OBSIDIAN_API_KEY;
  if (!apiKey) {
    console.error("usage: OBSIDIAN_API_KEY=... node scripts/compile-cli.mjs <Sources/xxx.md|pending|status>");
    process.exitCode = 1;
    return;
  }
  const client = new ObsidianClient({ baseUrl: BASE_URL, apiKey });
  const adapter = new ObsidianAdapter(client);
  if (arg === "pending") {
    try {
      const pending = await pendingSources(adapter);
      console.log(JSON.stringify({ status: "ok", pending }, null, 2));
    } catch (err) {
      console.log(JSON.stringify({ status: "error", message: errorMessage(err) }));
      process.exitCode = 1;
    }
    return;
  }
  // compile one source note
  const mcp = new McpClient({ baseUrl: BASE_URL, apiKey });
  const driver = new KarpathyDriver({ adapter, mcp });
  const status = statusFile();
  try {
    await recordCompileEvent(status, { stage: "triggered", source: arg });
    const snapshot = await driver.snapshotWiki();
    await recordCompileEvent(status, { stage: "waiting", source: arg });
    await driver.openAndIngest(arg);
    const compile = await driver.waitForIngest({ snapshot });
    await recordCompileEvent(status, { stage: "done", source: arg });
    console.log(JSON.stringify({ status: "compiled", created: compile.created, elapsedMs: compile.elapsedMs }, null, 2));
  } catch (err) {
    if (err instanceof WikiIngestTimeoutError) {
      await recordCompileEvent(status, { stage: "timeout", source: arg, message: "rate limit or slow compile" });
      console.log(JSON.stringify({ status: "timeout", message: "no wiki pages within the timeout; the karpathywiki backend may be rate-limited (request burst). Cool down before retrying; the source note is safe to leave un-translated.", source: arg }, null, 2));
      process.exitCode = 3;
    } else {
      await recordCompileEvent(status, { stage: "error", source: arg, message: errorMessage(err) });
      console.log(JSON.stringify({ status: "error", message: errorMessage(err) }, null, 2));
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`compile-cli: ${errorMessage(err)}`);
    process.exitCode = 1;
  });
}
