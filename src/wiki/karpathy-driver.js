// Karpathy LLM Wiki driver: trigger ingest from DSH and block until
// the compiled pages appear. Completion signal = new files under
// wiki/{sources,concepts,entities}. Ingest is slow (minutes), so the
// wait uses a long timeout and polls by default.

import { ObsidianError } from "../obsidian/obsidian-adapter.js";

const WIKI_DIRS = ["wiki/sources", "wiki/concepts", "wiki/entities"];
export const INGEST_ACTIVE_FILE = "karpathywiki:ingest-active-file";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class KarpathyDriver {
  constructor({ adapter, mcp, pollIntervalMs = 10000, timeoutMs = 15 * 60 * 1000 } = {}) {
    if (!adapter || !mcp) throw new Error("KarpathyDriver: adapter and mcp are required");
    this.adapter = adapter;
    this.mcp = mcp;
    this.pollIntervalMs = pollIntervalMs;
    this.timeoutMs = timeoutMs;
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
  async waitForIngest({ snapshot, timeoutMs = this.timeoutMs, pollIntervalMs = this.pollIntervalMs } = {}) {
    const before = snapshot ?? (await this.snapshotWiki());
    const deadline = Date.now() + timeoutMs;
    const startedAt = Date.now();
    while (Date.now() < deadline) {
      const after = await this.snapshotWiki();
      const created = this._diff(before, after);
      if (created.sources.length > 0 || created.concepts.length > 0 || created.entities.length > 0) {
        return { created, elapsedMs: Date.now() - startedAt };
      }
      await sleep(pollIntervalMs);
    }
    throw new Error(`ingest produced no wiki pages within ${timeoutMs}ms`);
  }
}
