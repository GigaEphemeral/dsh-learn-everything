// Vault-relative path validation for the Obsidian adapter.
// Guards against traversal, absolute paths, and the plugin config directory.

export class VaultPathError extends Error {
  constructor(message) {
    super(message);
    this.name = "VaultPathError";
  }
}

// Normalize and validate a vault-relative path.
// Returns the cleaned relative path (no leading/trailing "/", no "." or ".." segments).
export function assertVaultPath(path) {
  if (typeof path !== "string" || path.length === 0) {
    throw new VaultPathError("path must be a non-empty string");
  }
  if (path.startsWith("/")) {
    throw new VaultPathError("path must be vault-relative, got an absolute path");
  }
  const segments = path.split("/");
  const kept = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") throw new VaultPathError("path traversal is not allowed");
    if (seg === ".obsidian") throw new VaultPathError(".obsidian is not accessible");
    kept.push(seg);
  }
  return kept.join("/");
}

// Percent-encode each path segment for use in a request URL.
export function encodeVaultPath(path) {
  return assertVaultPath(path)
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}
