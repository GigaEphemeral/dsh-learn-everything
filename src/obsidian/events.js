// Vault event-stream subscription (S4): follow Obsidian change events (SSE)
// for notifications. POST /events/<emitter>/<event>/ returns a signed stream
// URL; GET it and read server-sent events. Read-only: never writes the vault.

export class VaultEventError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message, { cause });
    this.name = "VaultEventError";
    this.code = code;
  }
}

// Subscribe to one Obsidian event and return the signed listener URL.
// event: e.g. "modify" | "create" | "delete" under the vault emitter.
export async function subscribeVaultEvent({ baseUrl, apiKey, event = "modify", filter = null }) {
  const url = `${baseUrl}/events/vault/${encodeURIComponent(event)}/`;
  const headers = { Authorization: `Bearer ${apiKey}` };
  let body = null;
  let contentType = null;
  if (filter) {
    body = JSON.stringify(filter);
    headers["Content-Type"] = "application/vnd.olrapi.jsonlogic+json";
  }
  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch (err) {
    throw new VaultEventError(`event subscribe failed: ${err.message}`, { code: "network", cause: err });
  }
  if (!res.ok) {
    throw new VaultEventError(`event subscribe HTTP ${res.status}`, { code: "http" });
  }
  const j = await res.json().catch(() => null);
  if (!j || typeof j.url !== "string") {
    throw new VaultEventError("event subscribe returned no stream URL", { code: "shape" });
  }
  return { id: j.id, url: j.url, signed: j.signed === true };
}

// Follow a signed SSE stream: invoke onEvent for each `event:` line payload.
// Stops after stopMs (default 10s) so tests and callers never hang forever.
export async function streamEvents(streamUrl, { onEvent, stopMs = 10000, signal = null } = {}) {
  let res;
  try {
    res = await fetch(streamUrl, { signal });
  } catch (err) {
    throw new VaultEventError(`stream open failed: ${err.message}`, { code: "network", cause: err });
  }
  if (!res.ok || !res.body) {
    throw new VaultEventError(`stream HTTP ${res.status}`, { code: "http" });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + stopMs;
  try {
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data:"));
        if (line) onEvent?.(line.slice(5).trim());
      }
    }
  } finally {
    reader.releaseLock();
  }
}
