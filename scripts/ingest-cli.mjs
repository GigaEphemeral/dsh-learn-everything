// Ingest CLI (P3 /记住知识): fetch a source, preflight, confirm, write,
// compile via karpathywiki, report. Confirmation is read from stdin so the
// flow honors the no-write-without-confirmation gate headlessly; a closed
// stdin denies by default instead of hanging.
//
// Usage:
//   OBSIDIAN_API_KEY=... node scripts/ingest-cli.mjs <https-url>
//   OBSIDIAN_API_KEY=... node scripts/ingest-cli.mjs <local-markdown-path>
//   OBSIDIAN_API_KEY=... node scripts/ingest-cli.mjs <local-markdown-path> --auto-yes
//   --compile          also trigger karpathywiki compile after writing (default off)
//
// Exit codes: 0 completed, 1 usage/operational error, 2 pipeline ended without
// completing (cancelled or needs_review).

import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ObsidianClient, ObsidianAdapter } from "../src/obsidian/obsidian-adapter.js";
import { McpClient } from "../src/obsidian/mcp-client.js";
import { KarpathyDriver } from "../src/wiki/karpathy-driver.js";
import { SourceRegistry } from "../src/ingest/registry.js";
import { resolveStateDir } from "../src/ingest/state-dir.js";
import { IngestPipeline } from "../src/ingest/pipeline.js";
import { IngestTask } from "../src/ingest/task-state.js";
import { fetchUrl, readLocalFile, normalizeSource } from "../src/ingest/source-fetch.js";

const BASE_URL = process.env.OBSIDIAN_BASE_URL ?? "https://127.0.0.1:27124";
const USAGE = "usage: OBSIDIAN_API_KEY=... node scripts/ingest-cli.mjs <url|local-md> [--auto-yes] [--compile]";

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

// Load a source from a URL or a local Markdown file. Local files get a proper
// file:// URI (relative paths and Windows separators included) so the registry
// stores a stable, resolvable source identity.
async function acquire(target) {
  if (/^https?:\/\//.test(target)) {
    // HTML pages carry a real <title>; use it instead of the first Markdown line.
    const { markdown, title } = await fetchUrl(target, { withMetadata: true });
    return normalizeSource({ sourceUri: target, title: title ?? undefined, content: markdown });
  }
  const content = await readLocalFile(target);
  const title = basename(target).replace(/\.md$/i, "");
  return normalizeSource({ sourceUri: pathToFileURL(resolve(target)).href, title, content });
}

// Build the confirmation callback used by the pipeline. Prompted on stdin
// unless --auto-yes; a closed stdin (EOF/close/error, headless/CI) resolves
// false, i.e. deny by default. Kept as a factory so the EOF and listener
// cleanup behavior is unit-testable without a live vault.
export function createConfirm({
  stdin = process.stdin,
  stdout = process.stdout,
  autoYes = false,
} = {}) {
  return function confirm(prompt) {
    if (autoYes) {
      stdout.write(`[confirm auto-yes] ${prompt.split("\n")[0]}\n`);
      return Promise.resolve(true);
    }
    return new Promise((resolveAnswer) => {
      let settled = false;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        stdin.removeListener("data", onData);
        stdin.removeListener("end", onDeny);
        stdin.removeListener("close", onDeny);
        stdin.removeListener("error", onDeny);
        // Do not leave stdin flowing (or blocked) after the answer settled.
        stdin.pause();
        resolveAnswer(value);
      };
      function onData(chunk) {
        const answer = chunk.toString().trim().toLowerCase();
        finish(answer === "y" || answer === "yes");
      }
      function onDeny() {
        finish(false);
      }

      stdin.on("data", onData);
      stdin.once("end", onDeny);
      stdin.once("close", onDeny);
      stdin.once("error", onDeny);
      // The stream may already be at EOF before we subscribed; in that case
      // the end/close events will never fire again.
      if (stdin.readableEnded || stdin.destroyed) {
        finish(false);
        return;
      }
      stdout.write(`${prompt}\n[y/N] `);
    });
  };
}

async function main() {
  const apiKey = process.env.OBSIDIAN_API_KEY;
  const target = process.argv[2];
  if (!apiKey || !target) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const confirm = createConfirm({ autoYes: process.argv.includes("--auto-yes") });

  const client = new ObsidianClient({ baseUrl: BASE_URL, apiKey });
  const adapter = new ObsidianAdapter(client);
  const mcp = new McpClient({ baseUrl: BASE_URL, apiKey });
  // Compile is opt-in (S3 T3): the default is to store the source safely and
  // let the user trigger a possibly slow, rate-limit-prone compile later via
  // compile-cli.mjs.
  const driver = process.argv.includes("--compile") ? new KarpathyDriver({ adapter, mcp }) : null;
  const registry = await new SourceRegistry({
    filePath: join(resolveStateDir(import.meta.url), "sources.json"),
  }).load();

  const source = await acquire(target);
  console.log(
    "source:",
    JSON.stringify(
      { title: source.title, uri: source.sourceUri, hash: source.contentHash.slice(0, 16) },
      null,
      2,
    ),
  );

  const task = new IngestTask({ taskId: `ingest-${Date.now()}`, source });
  const pipeline = new IngestPipeline({ adapter, registry, driver, task });
  const report = await pipeline.run({ source, confirm });
  console.log("\nreport:", JSON.stringify(report, null, 2));
  if (!driver && report.status === "completed" && report.plan) {
    // Use the real written path so the hint is directly copy-pasteable.
    console.log(`hint: source stored without karpathywiki compile. To compile later:\n  node scripts/compile-cli.mjs ${report.plan.targetPath}   (or \`node scripts/compile-cli.mjs pending\` to list untranslated sources)`);
  }
  // process.exitCode (not process.exit) so pending stdout writes are flushed
  // before the process exits.
  process.exitCode = report.status === "completed" ? 0 : 2;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // Concise stderr (no raw stack), explicit non-zero exit, no unhandled
    // rejection.
    console.error(`ingest-cli: ${errorMessage(err)}`);
    process.exitCode = 1;
  });
}
