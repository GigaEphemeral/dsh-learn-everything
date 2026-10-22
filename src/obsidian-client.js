// Minimal HTTP client for the Obsidian "Local REST API with MCP" plugin.
// Uses node:https with TLS verification disabled (the plugin serves a locally
// generated certificate), a per-request timeout, and typed error mapping.

import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";

export class ObsidianError extends Error {
  constructor(message, { status = 0, errorCode = undefined } = {}) {
    super(message);
    this.name = "ObsidianError";
    this.status = status;
    this.errorCode = errorCode;
  }
}

function readBody(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    res.on("error", reject);
  });
}

export class ObsidianClient {
  constructor({ baseUrl = "https://127.0.0.1:27124", apiKey, timeoutMs = 15000 } = {}) {
    if (!apiKey) throw new Error("ObsidianClient: apiKey is required");
    const u = new URL(baseUrl);
    this.protocol = u.protocol === "http:" ? "http" : "https";
    this.host = u.hostname;
    this.port = u.port || (this.protocol === "https" ? 443 : 80);
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async request(method, path, { headers = {}, body, query } = {}) {
    const url = new URL(`${this.protocol}://${this.host}:${this.port}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    }
    const opts = {
      method,
      hostname: this.host,
      port: this.port,
      path: url.pathname + url.search,
      headers: { Authorization: `Bearer ${this.apiKey}`, ...headers },
      rejectUnauthorized: false,
    };
    if (body !== undefined) {
      opts.headers["Content-Length"] = Buffer.byteLength(body);
    }
    const res = await this._raw(opts, body);
    const status = res.statusCode;
    const text = await readBody(res);
    if (status >= 200 && status < 300) {
      if (!text) return undefined;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    let message = text;
    let errorCode;
    try {
      const j = JSON.parse(text);
      message = j.message ?? text;
      errorCode = j.errorCode;
    } catch {
      // Non-JSON error body; keep raw text.
    }
    throw new ObsidianError(message, { status, errorCode });
  }

  _raw(opts, body) {
    return new Promise((resolve, reject) => {
      const fn = this.protocol === "https" ? httpsRequest : httpRequest;
      const req = fn(opts, resolve);
      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new Error(`request timed out after ${this.timeoutMs}ms`));
      });
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }
}
