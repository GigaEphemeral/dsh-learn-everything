// Karpathy LLM Wiki driver: trigger ingest from DSH and block until
// the compiled pages appear. Completion signal = new files under
// wiki/{sources,concepts,entities}. Ingest is slow (minutes), so the
// wait uses a long timeout and polls by default.

import { ObsidianError } from "../obsidian/obsidian-adapter.js";

const WIKI_DIRS = ["wiki/sources", "wiki/concepts", "wiki/entities"];
export const INGEST_ACTIVE_FILE = "karpathywiki:ingest-active-file";

// Environment-driven defaults so each user can tune the wait without editing code.
// Documented in .env.example; constructor options always take precedence.
function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const DEFAULT_INGEST_TIMEOUT_MS = envNumber("OBSIDIAN_INGEST_TIMEOUT_MS", 15 * 60 * 1000);
export const DEFAULT_INGEST_POLL_INTERVAL_MS = envNumber("OBSIDIAN_INGEST_POLL_INTERVAL_MS", 10000);
// After the first new page appears, wait this long for late concept/entity pages
// to finish before declaring the compile complete.
export const DEFAULT_INGEST_SETTLE_MS = envNumber("OBSIDIAN_INGEST_SETTLE_MS", 60000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class KarpathyDriver {
  constructor({ adapter, mcp, pollIntervalMs = DEFAULT_INGEST_POLL_INTERVAL_MS, timeoutMs = DEFAULT_INGEST_TIMEOUT_MS, settleMs = DEFAULT_INGEST_SETTLE_MS } = {}) {
    if (!adapter || !mcp) throw new Error("KarpathyDriver: adapter and mcp are required");
    this.adapter = adapter;
    this.mcp = mcp;
    this.pollIntervalMs = pollIntervalMs;
    this.timeoutMs = timeoutMs;
    this.settleMs = settleMs;
  }

  // Snapshot current files in the three wiki output directories.
  async snapshotWiki() {
    const snap = {};
    for (const dir of WIKI_DIRS) {
      try {
        const { files } = await this.adapter.list(dir);
        snap[dir] = new Set(files ?? []);
      } catch (err) {
        if (err instanceof ObsidianError && err.status === 404) {
          snap[dir] = new Set();
        } else {
          throw err;
        }
      }
    }
    return snap;
  }

  // Diff a snapshot against the current state: what was created per dir.
  _diff(before, after) {
    const created = { sources: [], concepts: [], entities: [] };
    for (const dir of WIKI_DIRS) {
      const key = dir.split("/")[1];
      const beforeSet = before[dir] ?? new Set();
      for (const f of after[dir] ?? []) {
        if (!beforeSet.has(f)) created[key].push(f);
      }
    }
    return created;
  }

  // Open a source note (making it the active file) and trigger ingest.
  async openAndIngest(sourcePath) {
    await this.mcp.tool("open_file", { path: sourcePath });
    const out = await this.mcp.tool("command_execute", { commandId: INGEST_ACTIVE_FILE });
    if (!out.includes("OK")) {
      throw new Error(`ingest command did not return OK: ${out.slice(0, 200)}`);
    }
  }

  // Block until new wiki pages appear after an ingest, or until timeout.
  // Once the first new page shows up, keep polling for settleMs to also catch
  // concept/entity pages that finish later, so the report is complete.
  async waitForIngest({ snapshot, timeoutMs = this.timeoutMs, pollIntervalMs = this.pollIntervalMs, settleMs = this.settleMs } = {}) {
    const before = snapshot ?? (await this.snapshotWiki());
    const deadline = Date.now() + timeoutMs;
    const startedAt = Date.now();
    while (Date.now() < deadline) {
      const after = await this.snapshotWiki();
      const created = this._diff(before, after);
      if (created.sources.length > 0 || created.concepts.length > 0 || created.entities.length > 0) {
        // Wait out the settle window so late-generated pages are included.
        await sleep(settleMs);
        const final = await this.snapshotWiki();
        return { created: this._diff(before, final), elapsedMs: Date.now() - startedAt };
      }
      await sleep(pollIntervalMs);
    }
    throw new Error(`ingest produced no wiki pages within ${timeoutMs}ms`);
  }
}
