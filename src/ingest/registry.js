// Persistent source registry (P3): records which sources were ingested, so
// duplicate detection works across runs. Stored as JSON in a state dir.
//
// The registry is the only cross-run dedupe history, so a load failure must not
// be mistaken for "empty registry" (that would let the next save overwrite a
// corrupt or unreadable file). Only a missing file means "no history yet".
// Writes go through a same-directory temp file plus rename() so an interrupted
// save cannot leave a truncated registry behind.

import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

let tempSequence = 0;

// Build a contextual error that keeps the original failure as `cause`.
function registryError(action, filePath, cause) {
  const detail = cause?.message ? `: ${cause.message}` : "";
  return new Error(`SourceRegistry: failed to ${action} ${filePath}${detail}`, { cause });
}

export class SourceRegistry {
  constructor({ filePath }) {
    if (!filePath) throw new Error("SourceRegistry: filePath is required");
    this.filePath = filePath;
    this.records = [];
  }

  async load() {
    let raw;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (err) {
      // Only ENOENT means the registry does not exist yet. Anything else
      // (EACCES, EISDIR, EIO, ...) must surface instead of silently resetting.
      if (err?.code === "ENOENT") {
        this.records = [];
        return this;
      }
      throw registryError("read registry", this.filePath, err);
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw registryError("parse registry JSON", this.filePath, err);
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        `SourceRegistry: invalid registry shape in ${this.filePath}: expected an object with a "records" array`,
      );
    }
    if (!Array.isArray(parsed.records)) {
      throw new Error(
        `SourceRegistry: invalid registry shape in ${this.filePath}: "records" must be an array`,
      );
    }

    this.records = parsed.records;
    return this;
  }

  async save() {
    const dir = dirname(this.filePath);
    const tempPath = join(dir, `.${basename(this.filePath)}.${process.pid}.${++tempSequence}.tmp`);
    try {
      await mkdir(dir, { recursive: true });
      const payload = JSON.stringify({ records: this.records }, null, 2);
      // "wx" turns a temp-name collision into a hard error instead of clobbering.
      await writeFile(tempPath, payload, { flag: "wx" });
      // Same-directory rename is atomic on POSIX: readers see either the
      // previous complete file or the new complete file, never a partial one.
      await rename(tempPath, this.filePath);
    } catch (err) {
      await unlink(tempPath).catch(() => {});
      throw registryError("write registry", this.filePath, err);
    }
  }

  // Find a record with the same content hash (exact duplicate).
  findByHash(contentHash) {
    return this.records.find((r) => r.contentHash === contentHash);
  }

  // Find records with the same source URI.
  findByUri(sourceUri) {
    return this.records.filter((r) => r.sourceUri === sourceUri);
  }

  // Record an ingested source. Required identity fields are validated so an
  // empty hash/URI can never enter the dedupe history, and an exact duplicate
  // (same hash and same URI) is skipped instead of appended again.
  add({ contentHash, sourceUri, title, vaultPath, ingestedAt = new Date().toISOString() }) {
    if (typeof contentHash !== "string" || contentHash.trim() === "") {
      throw new Error("SourceRegistry: contentHash is required");
    }
    if (typeof sourceUri !== "string" || sourceUri.trim() === "") {
      throw new Error("SourceRegistry: sourceUri is required");
    }
    const duplicate = this.records.some(
      (record) => record.contentHash === contentHash && record.sourceUri === sourceUri,
    );
    if (!duplicate) {
      this.records.push({ contentHash, sourceUri, title, vaultPath, ingestedAt });
    }
    return this;
  }
}
