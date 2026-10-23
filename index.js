/**
 * dsh-learn-everything bundle entry: registers the packaged skills under
 * `skills/<name>/SKILL.md` on `ctx.skills`, so every session sees the
 * learning-system skills (remember-knowledge / knowledge-search /
 * daily-practice) in its skill catalog. Frontmatter is parsed with the
 * `yaml` library, matching the official skill providers.
 * @module dsh-learn-everything
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

/** Same rank as packaged dsh skill providers (BUNDLED_SKILL_RANK). */
const BUNDLED_SKILL_RANK = 600
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PROVIDER_NAME = 'dsh-learn-everything'
const SKILLS_ROOT = fileURLToPath(new URL('./skills/', import.meta.url))

export const name = 'dsh-learn-everything'
export const inject = ['skills']

export function apply(ctx) {
  ctx.skills.registerProvider(() => ({
    name: PROVIDER_NAME,
    async list(options) {
      options?.signal?.throwIfAborted()
      const listed = await loadSkills(options?.signal)
      options?.signal?.throwIfAborted()
      return cachedCandidates(listed)
    },
    async get(candidate, options) {
      options?.signal?.throwIfAborted()
      const listed = await loadSkills(options?.signal)
      const skill = catalogIndex(listed).get(candidate?.name)
      return skill === undefined ? undefined : toDefinition(skill)
    },
  }))
}

async function loadSkills(signal) {
  return loadSkillsCached(SKILLS_ROOT, signal)
}

// Catalog caches (F5): packaged skills only change with the plugin, so each
// root is loaded once and shared by every list()/get() call. The promise is
// memoized so concurrent first calls do not race; a failed load is evicted so
// the next call retries instead of replaying the rejection forever.
const catalogCache = new Map()
const candidateCache = new WeakMap()
const indexCache = new WeakMap()

// Exported for tests; the plugin itself always loads the packaged SKILLS_ROOT.
export function loadSkillsCached(root = SKILLS_ROOT, signal) {
  const cached = catalogCache.get(root)
  if (cached !== undefined) return cached.promise
  const entry = {}
  entry.promise = loadSkillsFrom(root, signal).catch((error) => {
    if (catalogCache.get(root) === entry) catalogCache.delete(root)
    throw error
  })
  catalogCache.set(root, entry)
  return entry.promise
}

function cachedCandidates(skills) {
  let candidates = candidateCache.get(skills)
  if (candidates === undefined) {
    candidates = skills.map(toCandidate)
    candidateCache.set(skills, candidates)
  }
  return candidates
}

function catalogIndex(skills) {
  let index = indexCache.get(skills)
  if (index === undefined) {
    index = new Map(skills.map((skill) => [skill.name, skill]))
    indexCache.set(skills, index)
  }
  return index
}

// Exported for tests and for callers that need a catalog from another root.
// The plugin itself always loads the packaged SKILLS_ROOT.
export async function loadSkillsFrom(root, signal) {
  // Sorting makes duplicate detection and the resulting error deterministic.
  const entries = (await readdir(root, { withFileTypes: true, signal })).sort((left, right) =>
    left.name.localeCompare(right.name),
  )
  const skills = []
  const byName = new Map()
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    signal?.throwIfAborted()
    const directory = join(root, entry.name)
    const skillFile = join(directory, 'SKILL.md')
    let raw
    try {
      raw = await readFile(skillFile, 'utf8')
    } catch (error) {
      // A directory without a readable SKILL.md (or a broken symlink) must not
      // take the whole provider down; other read failures still surface (F1).
      if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
        warnSkippedSkill(skillFile, `no readable SKILL.md (${error.code})`)
        continue
      }
      throw error
    }
    const parsed = parseSkill(raw, directory, skillFile)
    if (parsed === undefined) continue
    const duplicate = byName.get(parsed.name)
    if (duplicate !== undefined) {
      throw new Error(
        `${PROVIDER_NAME}: duplicate skill name "${parsed.name}" in ${duplicate.locator} and ${parsed.locator}`,
      )
    }
    byName.set(parsed.name, parsed)
    skills.push(parsed)
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

function warnSkippedSkill(skillFile, reason) {
  console.warn(`[${PROVIDER_NAME}] skipping skill ${skillFile}: ${reason}`)
}

// Malformed skills are skipped with a warning instead of aborting the whole
// catalog: missing/invalid frontmatter, missing name or description, and
// invalid skill names all follow the same policy (F2).
function parseSkill(raw, directory, skillFile) {
  const parsed = parseFrontmatter(raw)
  if (parsed === undefined) {
    warnSkippedSkill(skillFile, 'missing or invalid frontmatter')
    return undefined
  }
  const data = parsed.data
  const skillName = typeof data.name === 'string' ? data.name.trim() : undefined
  const description = typeof data.description === 'string' ? data.description.trim() : undefined
  if (!skillName || !description) {
    warnSkippedSkill(skillFile, 'frontmatter requires name and description')
    return undefined
  }
  if (!SKILL_NAME.test(skillName)) {
    warnSkippedSkill(skillFile, `invalid skill name "${skillName}"`)
    return undefined
  }
  return {
    name: skillName,
    description,
    ...optionalMetadata(data),
    invocation: {
      modelInvocable: data['disable-model-invocation'] !== true,
      userInvocable: data['user-invocable'] !== false,
    },
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: directory },
    rank: BUNDLED_SKILL_RANK,
    locator: skillFile,
    path: skillFile,
    content: parsed.body.trim(),
  }
}

function optionalMetadata(data) {
  const value = data.metadata
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return { metadata: value }
  }
  return {}
}

function parseFrontmatter(raw) {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return undefined
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) return undefined
  const parsed = parseYaml(raw.slice(start, closing.start))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return { data: parsed, body: raw.slice(closing.bodyStart) }
}

function findClosingFrontmatter(raw, start) {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
}

function toCandidate(skill) {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.metadata !== undefined ? { metadata: skill.metadata } : {}),
    invocation: skill.invocation,
    provider: skill.provider,
    source: skill.source,
    resourceBase: skill.resourceBase,
    rank: skill.rank,
    locator: skill.locator,
    path: skill.path,
  }
}

function toDefinition(skill) {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.metadata !== undefined ? { metadata: skill.metadata } : {}),
    invocation: skill.invocation,
    provider: skill.provider,
    source: skill.source,
    resourceBase: skill.resourceBase,
    path: skill.path,
    content: skill.content,
  }
}
