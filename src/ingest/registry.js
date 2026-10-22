// Persistent source registry (P3): records which sources were ingested, so
// duplicate detection works across runs. Stored as JSON in a state dir.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export class SourceRegistry {
  constructor({ filePath }) {
    if (!filePath) throw new Error("SourceRegistry: filePath is required");
    this.filePath = filePath;
    this.records = [];
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.records = JSON.parse(raw).records ?? [];
    } catch {
      this.records = [];
    }
    return this;
  }

  async save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ records: this.records }, null, 2));
  }

  // Find a record with the same content hash (exact duplicate).
  findByHash(contentHash) {
    return this.records.find((r) => r.contentHash === contentHash);
  }

  // Find records with the same source URI.
  findByUri(sourceUri) {
    return this.records.filter((r) => r.sourceUri === sourceUri);
  }

  // Record an ingested source.
  add({ contentHash, sourceUri, title, vaultPath, ingestedAt = new Date().toISOString() }) {
    this.records.push({ contentHash, sourceUri, title, vaultPath, ingestedAt });
    return this;
  }
}
