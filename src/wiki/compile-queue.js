// Compile bookkeeping shared by the compile CLI and the native compile tool:
// which source notes still need a wiki page, and status-file logging that must
// never turn a successful compile into an error.

import { ObsidianError } from '../obsidian/obsidian-adapter.js'
import { appendCompileEvent } from '../obsidian/compile-status.js'

// A source note is compiled when a wiki/sources page exists whose name equals
// the slug or appends KarpathyWiki's hash suffix. The suffix must look like a
// hash: slugs may legally contain "_" (e.g. foo_bar), so a bare prefix match
// would hide the uncompiled foo when only foo_bar was compiled.
const COMPILED_SUFFIX = /^[0-9a-f]{6,}$/i

/** @param file - vault path. @returns whether it is Markdown. */
export const isMarkdown = (file) => /\.md$/i.test(file)

/** @param file - vault path. @returns the name without a .md extension. */
export const withoutExtension = (file) => file.replace(/\.md$/i, '')

/**
 * @param slug - source note basename without extension.
 * @param wikiName - wiki/sources page basename without extension.
 * @returns whether the wiki page belongs to that source.
 */
export function isCompiled(slug, wikiName) {
  if (wikiName === slug) return true
  if (!wikiName.startsWith(slug + '_')) return false
  return COMPILED_SUFFIX.test(wikiName.slice(slug.length + 1))
}

/**
 * List source notes that have not produced a wiki source page yet.
 * @param adapter - Obsidian adapter.
 * @param sourcesDir - directory to scan (default Sources).
 * @param wikiSourcesDir - compiled-page directory (default wiki/sources).
 * @returns full source paths, ready for the compile command.
 */
export async function pendingSources(adapter, sourcesDir = 'Sources', wikiSourcesDir = 'wiki/sources') {
  const list = async (dir) => {
    try {
      const { files } = await adapter.list(dir)
      return files ?? []
    } catch (err) {
      if (err instanceof ObsidianError && err.status === 404) return []
      throw err
    }
  }
  const [sources, wikiPages] = await Promise.all([list(sourcesDir), list(wikiSourcesDir)])
  const wikiNames = wikiPages.filter(isMarkdown).map(withoutExtension)
  return sources
    .filter(isMarkdown)
    .filter((file) => !wikiNames.some((wikiName) => isCompiled(withoutExtension(file), wikiName)))
    .map((file) => sourcesDir + '/' + file)
}

/** Status bookkeeping must never fail a compile that already succeeded. */
export async function recordCompileEvent(filePath, event) {
  try {
    await appendCompileEvent(filePath, event)
  } catch (err) {
    console.warn('dsh-learn-everything: could not record ' + event.stage + ' compile status: '
      + (err instanceof Error ? err.message : String(err)))
  }
}
