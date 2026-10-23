// Minimal HTTP client for the Obsidian "Local REST API with MCP" plugin.
// Uses node:https with TLS verification disabled (the plugin serves a locally
// generated certificate), a single request deadline, and typed error mapping.

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

// Request bodies are written to the socket and measured for Content-Length, so
// anything other than a string or Buffer is a caller bug (C11).
function assertBodyType(body) {
  if (body !== undefined && typeof body !== "string" && !Buffer.isBuffer(body)) {
    throw new TypeError("ObsidianClient: body must be a string or Buffer");
  }
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
    assertBodyType(body);
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
    let text;
    try {
      text = await readBody(res);
    } catch (cause) {
      throw new ObsidianError(`Obsidian request failed while reading the response: ${cause.message}`, { status: 0 });
    }
    if (status >= 200 && status < 300) {
      if (!text) return undefined;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    // HTTP error: keep the server-provided message when the body is JSON, and
    // fall back to `HTTP <status>` for empty bodies (C12).
    let message = text.trim() === "" ? `HTTP ${status}` : text;
    let errorCode;
    try {
      const j = JSON.parse(text);
      if (typeof j?.message === "string" && j.message.trim() !== "") message = j.message;
      errorCode = j?.errorCode;
    } catch {
      // Non-JSON error body; keep the raw text (or the HTTP fallback above).
    }
    throw new ObsidianError(message, { status, errorCode });
  }

  // Single deadline for the whole connect + response-headers phase (C10). It is
  // cleared as soon as headers arrive, so a large or slow body is not killed by
  // a stale socket-inactivity timer; transport errors are wrapped (C12).
  _raw(opts, body) {
    return new Promise((resolve, reject) => {
      const fn = this.protocol === "https" ? httpsRequest : httpRequest;
      let timer;
      const req = fn(opts, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
      timer = setTimeout(() => {
        req.destroy(new ObsidianError(`Obsidian request timed out after ${this.timeoutMs}ms`, { status: 0 }));
      }, this.timeoutMs);
      req.on("error", (err) => {
        clearTimeout(timer);
        reject(
          err instanceof ObsidianError
            ? err
            : new ObsidianError(`Obsidian request failed: ${err.message}`, { status: 0 }),
        );
      });
      if (body !== undefined) req.write(body);
      req.end();
    });
  }
}
