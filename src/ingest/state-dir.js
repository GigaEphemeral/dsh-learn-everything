// Resolve the plugin's runtime state directory (ingest registry, attempts,
// review). Defaults to the nearest package root's .state; OBSIDIAN_STATE_DIR
// overrides with a trimmed absolute path. Kept in its own module so it is
// unit-testable and consistent across all scripts.
//
// A script URL is only used when it is a file: URL; anything else (https:, a
// malformed value) falls back to the cwd-based default instead of throwing.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Walk up from a directory until a package.json marks the package root.
function findPackageRoot(startDir) {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Resolve the script path from a module URL, or null when it is not a valid
// file: URL.
function scriptPathFromUrl(scriptMetaUrl) {
  if (typeof scriptMetaUrl !== "string" || !scriptMetaUrl.startsWith("file:")) return null;
  try {
    return fileURLToPath(scriptMetaUrl);
  } catch {
    return null;
  }
}

export function resolveStateDir(scriptMetaUrl) {
  const override = process.env.OBSIDIAN_STATE_DIR?.trim();
  if (override) return resolve(override);

  const scriptPath = scriptPathFromUrl(scriptMetaUrl);
  if (!scriptPath) return join(process.cwd(), ".state");

  const scriptDir = dirname(scriptPath);
  // Prefer the real package root; fall back to the script's parent directory
  // (the historical default) when no package.json is reachable.
  const baseDir = findPackageRoot(scriptDir) ?? dirname(scriptDir);
  return join(baseDir, ".state");
}
