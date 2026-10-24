// Vault event-stream subscription (S4): follow Obsidian change events (SSE)
// for notifications. The transport follows the base URL's protocol (https for
// the plugin's self-signed certificate, plain http for a loopback listener).
// Read-only: never writes the vault.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const DEFAULT_TRANSPORTS = { "http:": httpRequest, "https:": httpsRequest };
const MAX_SSE_BUFFER = 1024 * 1024;

/** Pick the request transport for a URL, unless the caller injected one. */
export function transportFor(url, transport) {
  if (transport !== undefined) return transport;
  return DEFAULT_TRANSPORTS[url.protocol] ?? httpsRequest;
}

export class VaultEventError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message, { cause });
    this.name = "VaultEventError";
    this.code = code;
  }
}

function httpJson({ method, url, apiKey, body, contentType, timeoutMs = 15000, transport }) {
  const u = new URL(url);
  const request = transportFor(u, transport);
  const opts = {
    method,
    hostname: u.hostname,
    port: u.port || (u.protocol === "http:" ? 80 : 443),
    path: u.pathname + u.search,
    rejectUnauthorized: false,
    headers: {},
  };
  if (apiKey) opts.headers.Authorization = `Bearer ${apiKey}`;
  if (body !== undefined) {
    opts.headers["Content-Length"] = Buffer.byteLength(body);
    if (contentType) opts.headers["Content-Type"] = contentType;
  }
  return new Promise((resolve, reject) => {
    const req = request(opts, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode, text });
        else reject(new VaultEventError(`HTTP ${res.statusCode}${text.trim() ? `: ${text.trim()}` : ""}`, { code: "http" }));
      });
    });
    req.on("error", (err) => reject(new VaultEventError(`request failed: ${err.message}`, { code: "network", cause: err })));
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// Subscribe to one Obsidian event and return the signed listener URL.
export async function subscribeVaultEvent({ baseUrl, apiKey, event = "modify", filter = null, transport }) {
  const url = `${baseUrl}/events/vault/${encodeURIComponent(event)}/`;
  const body = filter ? JSON.stringify(filter) : undefined;
  const contentType = filter ? "application/vnd.olrapi.jsonlogic+json" : undefined;
  const { text } = await httpJson({ method: "POST", url, apiKey, body, contentType, transport });
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new VaultEventError("event subscribe returned non-JSON", { code: "shape" });
  }
  if (!parsed || typeof parsed.url !== "string") {
    throw new VaultEventError("event subscribe returned no stream URL", { code: "shape" });
  }
  return { id: parsed.id, url: parsed.url, signed: parsed.signed === true };
}

// Follow a signed SSE stream: invoke onEvent per complete event. Stops after
// stopMs so tests and callers never hang forever. Every exit path settles the
// promise exactly once, and an intentional stop cannot surface as a failure.
export function streamEvents(streamUrl, { onEvent, stopMs = 10000, apiKey, transport } = {}) {
  const u = new URL(streamUrl);
  const request = transportFor(u, transport);
  return new Promise((resolve, reject) => {
    let settled = false;
    let stopped = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const req = request({
      hostname: u.hostname,
      port: u.port || (u.protocol === "http:" ? 80 : 443),
      path: u.pathname + u.search,
      rejectUnauthorized: false,
      headers,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        finish(reject, new VaultEventError(`stream HTTP ${res.statusCode}`, { code: "http" }));
        return;
      }
      let buffer = "";
      const deadline = Date.now() + stopMs;
      const timer = setTimeout(() => {
        stopped = true;
        req.destroy();
      }, Math.max(stopMs + 500, 1000));
      const stop = () => {
        clearTimeout(timer);
        stopped = true;
        req.destroy();
        finish(resolve);
      };
      res.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        if (buffer.length > MAX_SSE_BUFFER) {
          // A peer that never sends the delimiter must not grow memory forever.
          buffer = "";
        }
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).replace(/^ /, ""))
            .join("\n");
          if (data) onEvent?.(data);
        }
        if (Date.now() > deadline) stop();
      });
      res.on("end", () => { clearTimeout(timer); finish(resolve); });
      res.on("close", () => { clearTimeout(timer); finish(resolve); });
      res.on("error", (err) => {
        clearTimeout(timer);
        if (stopped) finish(resolve);
        else finish(reject, new VaultEventError(`stream error: ${err.message}`, { code: "network", cause: err }));
      });
    });
    req.on("error", (err) => {
      if (stopped) finish(resolve);
      else finish(reject, new VaultEventError(`stream open failed: ${err.message}`, { code: "network", cause: err }));
    });
    req.end();
  });
}
