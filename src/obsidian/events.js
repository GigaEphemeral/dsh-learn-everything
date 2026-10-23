// Vault event-stream subscription (S4): follow Obsidian change events (SSE)
// for notifications. Uses node:https with TLS verification disabled (the
// plugin serves a locally generated certificate), like ObsidianClient.
// Read-only: never writes the vault.

import { request as httpsRequest } from "node:https";

const DEFAULT_TRANSPORT = httpsRequest;

export class VaultEventError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message, { cause });
    this.name = "VaultEventError";
    this.code = code;
  }
}

function httpJson({ method, url, apiKey, body, contentType, timeoutMs = 15000, transport = DEFAULT_TRANSPORT }) {
  const u = new URL(url);
  const opts = {
    method,
    hostname: u.hostname,
    port: u.port || 443,
    path: u.pathname + u.search,
    rejectUnauthorized: false,
    headers: { Authorization: `Bearer ${apiKey}` },
  };
  if (body !== undefined) {
    opts.headers["Content-Length"] = Buffer.byteLength(body);
    if (contentType) opts.headers["Content-Type"] = contentType;
  }
  return new Promise((resolve, reject) => {
    const req = transport(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode, text });
        else reject(new VaultEventError(`HTTP ${res.statusCode}`, { code: "http" }));
      });
    });
    req.on("error", (err) => reject(new VaultEventError(`request failed: ${err.message}`, { code: "network", cause: err })));
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// Subscribe to one Obsidian event and return the signed listener URL.
export async function subscribeVaultEvent({ baseUrl, apiKey, event = "modify", filter = null, transport = DEFAULT_TRANSPORT }) {
  const url = `${baseUrl}/events/vault/${encodeURIComponent(event)}/`;
  const body = filter ? JSON.stringify(filter) : undefined;
  const contentType = filter ? "application/vnd.olrapi.jsonlogic+json" : undefined;
  const { text } = await httpJson({ method: "POST", url, apiKey, body, contentType, transport });
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new VaultEventError("event subscribe returned non-JSON", { code: "shape" });
  }
  if (!j || typeof j.url !== "string") {
    throw new VaultEventError("event subscribe returned no stream URL", { code: "shape" });
  }
  return { id: j.id, url: j.url, signed: j.signed === true };
}

// Follow a signed SSE stream: invoke onEvent per data line. Stops after
// stopMs so tests and callers never hang forever.
export function streamEvents(streamUrl, { onEvent, stopMs = 10000, transport = DEFAULT_TRANSPORT } = {}) {
  const u = new URL(streamUrl);
  return new Promise((resolve, reject) => {
    const req = transport({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      rejectUnauthorized: false,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new VaultEventError(`stream HTTP ${res.statusCode}`, { code: "http" }));
        return;
      }
      let buffer = "";
      let stopped = false;
      const deadline = Date.now() + stopMs;
      const timer = setTimeout(() => { stopped = true; req.destroy(); }, Math.max(stopMs + 500, 1000));
      res.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = block.split("\n").find((l) => l.startsWith("data:"));
          if (line) onEvent?.(line.slice(5).trim());
        }
        if (Date.now() > deadline) { req.destroy(); }
      });
      res.on("end", () => { clearTimeout(timer); resolve(); });
      res.on("error", (err) => { clearTimeout(timer); if (stopped) resolve(); else reject(new VaultEventError(`stream error: ${err.message}`, { code: "network", cause: err })); });
    });
    req.on("error", (err) => reject(new VaultEventError(`stream open failed: ${err.message}`, { code: "network", cause: err })));
    req.end();
  });
}
