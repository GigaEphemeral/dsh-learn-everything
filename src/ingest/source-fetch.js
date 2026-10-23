// Source acquisition for the ingest pipeline (P3).
// Supports HTTPS URLs and local Markdown files, with size/timeout limits,
// protocol restrictions, and a normalized output shape.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export class SourceFetchError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message, { cause });
    this.name = "SourceFetchError";
    this.code = code;
  }
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

// Fetch an HTTPS URL with a hard size cap and timeout. HTTP (non-TLS) and
// file:// are refused; redirects are followed only within https.
export async function fetchUrl(url, { maxBytes = 512 * 1024, timeoutMs = 20000 } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch (err) {
    throw new SourceFetchError(`invalid URL: ${url}`, { code: "url", cause: err });
  }
  if (u.protocol !== "https:") {
    throw new SourceFetchError(`refusing non-HTTPS URL protocol "${u.protocol}"`, { code: "protocol" });
  }
  let res;
  try {
    res = await fetch(u, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  } catch (err) {
    throw new SourceFetchError(`fetch failed: ${err.message}`, { code: "network" });
  }
  if (!res.ok) {
    throw new SourceFetchError(`HTTP ${res.status} ${res.statusText}`, { code: "http" });
  }
  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) {
    throw new SourceFetchError(`content exceeds ${maxBytes} bytes`, { code: "size" });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new SourceFetchError(`content exceeds ${maxBytes} bytes`, { code: "size" });
  }
  return buf.toString("utf8");
}

// Read a local text file (Markdown source) with a size cap.
export async function readLocalFile(path, { maxBytes = 512 * 1024 } = {}) {
  let buf;
  try {
    buf = await readFile(path);
  } catch (err) {
    // Normalize ENOENT/EACCES/EISDIR/... into the module's error contract so
    // callers can handle file sources uniformly by code.
    throw new SourceFetchError(`failed to read file "${path}": ${err.message}`, { code: "io", cause: err });
  }
  if (buf.byteLength > maxBytes) {
    throw new SourceFetchError(`file exceeds ${maxBytes} bytes`, { code: "size" });
  }
  return buf.toString("utf8");
}

// Normalize any acquired content into the ingest source shape.
export function normalizeSource({ sourceUri, title, content, contentType = "markdown", fetchedAt = new Date().toISOString(), parserVersion = "v1", warnings = [] }) {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new SourceFetchError("source content is empty", { code: "empty" });
  }
  return {
    sourceId: sha256(trimmed).slice(0, 16),
    sourceUri,
    title: title || trimmed.split("\n")[0].replace(/^#+\s*/, "").slice(0, 120) || "untitled",
    content: trimmed,
    contentType,
    contentHash: sha256(trimmed),
    fetchedAt,
    parserVersion,
    warnings,
  };
}
