// Resolve the plugin's runtime state directory (ingest registry, attempts,
// review). Defaults to code/.state relative to this package; OBSIDIAN_STATE_DIR
// overrides. Kept in its own module so it is unit-testable and consistent
// across all scripts.

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveStateDir(scriptMetaUrl) {
  if (process.env.OBSIDIAN_STATE_DIR) return process.env.OBSIDIAN_STATE_DIR;
  if (scriptMetaUrl) {
    // scripts/<x>.mjs -> package root/.state
    return join(dirname(fileURLToPath(scriptMetaUrl)), "..", ".state");
  }
  return join(process.cwd(), ".state");
}
