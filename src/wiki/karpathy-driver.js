// Karpathy LLM Wiki driver: trigger ingest from DSH and block until
// the compiled pages appear. Completion signal = new files under
// wiki/{sources,concepts,entities}. Ingest is slow (minutes), so the
// wait uses a long timeout and polls by default.

import { ObsidianError } from "../obsidian/obsidian-adapter.js";

export const WIKI_DIRS = ["wiki/sources", "wiki/concepts", "wiki/entities"];

// Explicit directory -> report key map. Deriving the key from the path with
// `split("/")[1]` silently breaks for any nested wiki layout (D4).
export const WIKI_DIR_KEYS = Object.freeze({
  "wiki/sources": "sources",
  "wiki/concepts": "concepts",
  "wiki/entities": "entities",
});

export const INGEST_ACTIVE_FILE = "karpathywiki:ingest-active-file";

// Ingest polling has its own failure mode: nothing compiled before the
// deadline. A dedicated error type/code lets callers distinguish that from
// transport or MCP failures (D6).
export class WikiIngestTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`ingest produced no wiki pages within ${timeoutMs}ms`);
    this.name = "WikiIngestTimeoutError";
    this.code = "WIKI_INGEST_TIMEOUT";
    this.timeoutMs = timeoutMs;
  }
}

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

// Constructor options must be usable durations; 0/negative/NaN would busy-loop,
// time out immediately, or skip the settle window (D3).
function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// The ingest command returns JSON `{"message":"OK"}`; only fall back to the
// plain trimmed "OK" when the output is not JSON (D2).
function isIngestOk(output) {
  if (typeof output !== "string") return false;
  const trimmed = output.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object") {
      return typeof parsed.message === "string" && parsed.message.trim() === "OK";
    }
  } catch {
    // Not JSON; use the plain-text fallback below.
  }
  return trimmed === "OK";
}

export class KarpathyDriver {
  constructor({ adapter, mcp, pollIntervalMs = DEFAULT_INGEST_POLL_INTERVAL_MS, timeoutMs = DEFAULT_INGEST_TIMEOUT_MS, settleMs = DEFAULT_INGEST_SETTLE_MS } = {}) {
    if (!adapter || !mcp) throw new Error("KarpathyDriver: adapter and mcp are required");
    this.adapter = adapter;
    this.mcp = mcp;
    this.pollIntervalMs = positiveNumber(pollIntervalMs, DEFAULT_INGEST_POLL_INTERVAL_MS);
    this.timeoutMs = positiveNumber(timeoutMs, DEFAULT_INGEST_TIMEOUT_MS);
    this.settleMs = positiveNumber(settleMs, DEFAULT_INGEST_SETTLE_MS);
  }

  // Snapshot current files in the three wiki output directories. The three list
  // calls are independent, so they run in parallel (D5). A missing directory
  // (404) degrades to an empty set; every other failure is rethrown.
  async snapshotWiki() {
    const snapshots = await Promise.all(
      WIKI_DIRS.map(async (dir) => {
        try {
          const { files } = await this.adapter.list(dir);
          return new Set(files ?? []);
        } catch (err) {
          if (err instanceof ObsidianError && err.status === 404) return new Set();
          throw err;
        }
      }),
    );
    // Build the snapshot from the fixed directory order so its keys stay
    // deterministic regardless of which request resolves first.
    const snap = {};
    WIKI_DIRS.forEach((dir, index) => {
      snap[dir] = snapshots[index];
    });
    return snap;
  }

  // Diff a snapshot against the current state: what was created per dir.
  _diff(before, after) {
    const created = {};
    for (const key of Object.values(WIKI_DIR_KEYS)) created[key] = [];
    for (const dir of WIKI_DIRS) {
      const key = WIKI_DIR_KEYS[dir];
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
    if (!isIngestOk(out)) {
      throw new Error(`ingest command did not return OK: ${typeof out === "string" ? out.slice(0, 200) : String(out)}`);
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
        // Wait out the settle window so late-generated pages are included, but
        // never sleep past the overall deadline (D1).
        const remaining = Math.max(0, deadline - Date.now());
        await sleep(Math.min(settleMs, remaining));
        const final = await this.snapshotWiki();
        return { created: this._diff(before, final), elapsedMs: Date.now() - startedAt };
      }
      await sleep(pollIntervalMs);
    }
    throw new WikiIngestTimeoutError(timeoutMs);
  }
}
