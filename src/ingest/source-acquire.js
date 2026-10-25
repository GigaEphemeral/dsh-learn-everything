// Acquire an ingest source from a URL or a local Markdown file. Shared by the
// ingest CLI and the native ingest tool so both normalize the same identity
// (file:// URI for local files, a stable source_uri for URLs).

import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fetchUrl, readLocalFile, normalizeSource } from './source-fetch.js'

/**
 * Load one source into the normalized shape the ingest pipeline expects.
 * @param target - http(s) URL or local Markdown path.
 * @returns the normalized source object.
 */
export async function acquireSource(target) {
  if (typeof target !== 'string' || target.trim() === '') {
    throw new Error('acquireSource: target must be a non-empty URL or local Markdown path')
  }
  const trimmed = target.trim()
  if (/^https?:\/\//.test(trimmed)) {
    const { markdown, title } = await fetchUrl(trimmed, { withMetadata: true })
    return normalizeSource({ sourceUri: trimmed, title: title ?? undefined, content: markdown })
  }
  const content = await readLocalFile(trimmed)
  const title = basename(trimmed).replace(/\.md$/i, '')
  return normalizeSource({ sourceUri: pathToFileURL(resolve(trimmed)).href, title, content })
}
