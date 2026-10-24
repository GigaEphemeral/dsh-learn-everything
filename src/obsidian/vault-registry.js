// Obsidian vault-registry validation (S4). The Local REST API is scoped to the
// open vault and exposes no vault-name endpoint, so the only local source of
// truth is Obsidian's own vault registry. A configured vault name must match a
// registered vault (normally the open one); a nonexistent name would otherwise
// produce dead obsidian:// links.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/** Default Obsidian vault-registry path per platform (OBSIDIAN_VAULTS_FILE overrides). */
export function defaultVaultRegistryFile(env = process.env, platform = process.platform) {
  if (env.OBSIDIAN_VAULTS_FILE?.trim()) return env.OBSIDIAN_VAULTS_FILE.trim();
  const home = homedir();
  if (platform === "darwin") return join(home, "Library/Application Support/obsidian/obsidian.json");
  if (platform === "win32") return join(env.APPDATA ?? join(home, "AppData/Roaming"), "obsidian/obsidian.json");
  const configHome = env.XDG_CONFIG_HOME?.trim() || join(home, ".config");
  return join(configHome, "obsidian/obsidian.json");
}

/**
 * Read the registered vault names. `verifiable:false` means the registry is
 * unavailable/unreadable, so a name cannot be checked (callers should not
 * block configuration on a machine without a registry).
 * @returns the registered names, the open vault name, and verifiability.
 */
export async function readVaultRegistry(options = {}) {
  const registryFile = options.registryFile ?? defaultVaultRegistryFile(options.env, options.platform);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(registryFile, "utf8"));
  } catch {
    return { verifiable: false, registryFile, names: [], openName: null };
  }
  const vaults = parsed?.vaults;
  if (!vaults || typeof vaults !== "object") {
    return { verifiable: false, registryFile, names: [], openName: null };
  }
  const entries = Object.values(vaults)
    .filter((entry) => entry && typeof entry.path === "string" && entry.path.trim())
    .map((entry) => ({ name: basename(entry.path), open: entry.open === true }));
  const names = [...new Set(entries.map((entry) => entry.name))];
  const open = entries.find((entry) => entry.open);
  return { verifiable: true, registryFile, names, openName: open?.name ?? null };
}

/**
 * Check a configured vault name against the registry.
 * @returns ok/verified plus available names when the name is unknown.
 */
export async function validateVaultName(name, options = {}) {
  const candidate = String(name ?? "").trim();
  if (!candidate) return { ok: false, verified: true, reason: "missing", available: [] };
  const registry = await readVaultRegistry(options);
  if (!registry.verifiable) return { ok: true, verified: false, available: [], openName: null };
  const known = registry.names.includes(candidate);
  return {
    ok: known,
    verified: true,
    available: registry.names,
    openName: registry.openName,
    reason: known ? undefined : "unknown-vault",
  };
}
