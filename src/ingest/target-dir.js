// Ingest target-directory policy. Sources may be filed into any nested folder
// under the vault's Sources root (the folder is created implicitly by the
// Obsidian write/move API), but never outside that root.

import { VaultPathError, assertVaultPath } from '../obsidian/vault-path.js'

/** Default root every ingest target must stay under. */
export const DEFAULT_SOURCES_ROOT = 'Sources'

/**
 * Normalize and validate an ingest target directory.
 * @param dir - requested directory, relative to the vault; defaults to the root.
 * @param options - 'root' overrides the allowed root (defaults to Sources).
 * @returns the normalized directory path.
 * @throws {VaultPathError} when the path is absolute, traversing, or outside the root.
 */
export function assertTargetDir(dir, { root = DEFAULT_SOURCES_ROOT } = {}) {
  const normalizedRoot = assertVaultPath(root)
  const requested = typeof dir === 'string' && dir.trim() !== '' ? dir.trim() : normalizedRoot
  const normalized = assertVaultPath(requested)
  if (normalized !== normalizedRoot && !normalized.startsWith(normalizedRoot + '/')) {
    throw new VaultPathError('ingest target "' + normalized + '" must stay under "' + normalizedRoot + '/"')
  }
  return normalized
}
