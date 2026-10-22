// Unified Obsidian adapter: safe, idempotent vault operations on top of
// ObsidianClient. All Skills in the learning system should use this module
// instead of issuing their own HTTP calls.

import { ObsidianClient, ObsidianError } from "./obsidian-client.js";
import { VaultPathError, encodeVaultPath } from "./vault-path.js";

export { ObsidianClient, ObsidianError, VaultPathError };

export class ObsidianAdapter {
  constructor(client, { scope } = {}) {
    this.client = client;
    this.scope = scope ? scope.replace(/^\/+|\/+$/g, "") : undefined;
  }

  // Enforce adapter scope on top of the base path validation.
  _path(p) {
    const rel = encodeVaultPath(p);
    if (this.scope && rel !== this.scope && !rel.startsWith(this.scope + "/")) {
      throw new VaultPathError(`path "${rel}" is outside adapter scope "${this.scope}"`);
    }
    return rel;
  }

  async list(dir = "") {
    // The vault root is addressed without a path segment.
    if (dir === "") return this.client.request("GET", "/vault/");
    return this.client.request("GET", `/vault/${this._path(dir)}`);
  }

  async read(path, { json = false } = {}) {
    const headers = json ? { Accept: "application/vnd.olrapi.note+json" } : {};
    return this.client.request("GET", `/vault/${this._path(path)}`, { headers });
  }

  // Create a note. Never overwrites: the server rejects with 412 if the file exists.
  async create(path, content) {
    return this.client.request("PUT", `/vault/${this._path(path)}`, {
      headers: { "Content-Type": "text/markdown", "If-None-Match": "*" },
      body: content,
    });
  }

  // Append to the end of a note via a root-target append patch.
  async append(path, content) {
    return this.client.request("PATCH", `/vault/${this._path(path)}`, {
      headers: { Operation: "append", "Content-Type": "text/markdown" },
      body: content,
    });
  }

  // Update a single frontmatter field; other fields are preserved server-side.
  async updateFrontmatter(path, key, value, { createIfMissing = true } = {}) {
    const headers = { Operation: "replace", "Content-Type": "application/json" };
    if (createIfMissing) headers["Create-Target-If-Missing"] = "true";
    return this.client.request(
      "PATCH",
      `/vault/${this._path(path)}/frontmatter/${encodeURIComponent(key)}`,
      { headers, body: JSON.stringify(value) },
    );
  }

  async search(query) {
    return this.client.request("POST", "/search/simple/", { query: { query } });
  }

  async delete(path) {
    return this.client.request("DELETE", `/vault/${this._path(path)}`);
  }

  async exists(path) {
    try {
      await this.read(path);
      return true;
    } catch (err) {
      if (err instanceof ObsidianError && err.status === 404) return false;
      throw err;
    }
  }
}
