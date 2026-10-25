// Native ingest tool (obs_ingest). The host performs preflight and the
// create-only write, so an agent never needs a shell, a repository checkout or
// an .env file on any OS. Writes honour the plugin's "allow ingest" switch and
// the skill's confirmation gates: the agent asks in conversation and only then
// passes confirm: true.

import { join } from 'node:path'
import { ObsidianClient, ObsidianAdapter } from '../obsidian/obsidian-adapter.js'
import { SourceRegistry } from '../ingest/registry.js'
import { resolveStateDir } from '../ingest/state-dir.js'
import { IngestPipeline } from '../ingest/pipeline.js'
import { IngestTask } from '../ingest/task-state.js'
import { buildPreflight } from '../ingest/preflight.js'
import { acquireSource } from '../ingest/source-acquire.js'
import { assertTargetDir } from '../ingest/target-dir.js'

const WIKI_SOURCES_DIR = 'wiki/sources'
const ACTIONS = ['preflight', 'write']

const OUTPUT = {
  schema: { type: 'object' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

function configured(getConfig) {
  return typeof getConfig === 'function' ? (getConfig() ?? {}) : {}
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function notConfigured() {
  return {
    status: 'obsidian-not-configured',
    message: 'Configure the Obsidian API key in the plugin settings first.',
  }
}

async function loadRegistry() {
  return new SourceRegistry({
    filePath: join(resolveStateDir(import.meta.url), 'sources.json'),
  }).load()
}

function adapterFor(cfg) {
  return new ObsidianAdapter(new ObsidianClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey }))
}

async function runPreflight(args, cfg) {
  const dir = assertTargetDir(args.dir)
  const source = await acquireSource(args.target)
  const adapter = adapterFor(cfg)
  const registry = await loadRegistry()
  const pre = await buildPreflight({
    source,
    registry,
    adapter,
    targetDir: dir,
    wikiSourcesDir: WIKI_SOURCES_DIR,
  })
  return {
    status: 'preflighted',
    dir,
    title: source.title,
    sourceUri: source.sourceUri,
    contentHash: source.contentHash,
    targetPath: pre.targetPath,
    duplicate: pre.duplicate,
    warnings: pre.warnings,
  }
}

async function runWrite(args, cfg) {
  if (args.confirm !== true) {
    return {
      status: 'confirmation-required',
      message: 'Show the preflight to the user, wait for an explicit yes, then call again with confirm: true.',
    }
  }
  const dir = assertTargetDir(args.dir)
  const source = await acquireSource(args.target)
  if (typeof args.expectedHash === 'string' && args.expectedHash !== '' && args.expectedHash !== source.contentHash) {
    return { status: 'source-changed', expectedHash: args.expectedHash, actualHash: source.contentHash }
  }
  const adapter = adapterFor(cfg)
  const registry = await loadRegistry()
  const task = new IngestTask({ taskId: 'ingest-' + Date.now(), source })
  const pipeline = new IngestPipeline({ adapter, registry, driver: null, task, targetDir: dir })
  const report = await pipeline.run({ source, confirm: async () => true })
  return {
    status: report.status,
    stage: report.stage ?? null,
    reason: report.reason ?? null,
    error: report.error ?? null,
    dir,
    targetPath: report.plan?.targetPath ?? report.preflight?.targetPath ?? null,
    duplicate: report.preflight?.duplicate ?? null,
    warnings: report.warnings ?? [],
    registry: report.registry ?? null,
  }
}

/** Registry-ready definition for obs_ingest. */
export function ingestToolSpec({ getConfig } = {}) {
  return {
    name: 'obs_ingest',
    description: 'Ingest one URL or local Markdown into the Obsidian vault under Sources, optionally into a nested directory: action "preflight" reports the target path, content hash and duplicate signal without writing; action "write" performs the create-only write, read-back verification and registry update after the user confirmed.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ACTIONS,
          description: 'preflight (read-only) or write (create-only, requires confirm: true).',
        },
        target: { type: 'string', description: 'http(s) URL or local Markdown path to ingest.' },
        dir: {
          type: 'string',
          description: 'Vault directory for the note, relative to Sources (default "Sources"); nested paths such as "Sources/复盘/2026" are created implicitly.',
        },
        expectedHash: {
          type: 'string',
          description: 'Content hash returned by preflight; write refuses if the source changed since then.',
        },
        confirm: { type: 'boolean', description: 'Set true only after the user explicitly confirmed the write.' },
      },
      required: ['action'],
    },
    output: OUTPUT,
    timeoutMs: 180000,
    execute: async (args) => {
      const cfg = configured(getConfig)
      if (args?.action !== 'preflight' && args?.action !== 'write') {
        throw new Error('obs_ingest: action must be "preflight" or "write"')
      }
      if (!cfg.apiKey) return notConfigured()
      // The switch makes ingest read-only: preflight still works, writes refuse.
      if (args.action === 'write' && cfg.ingest === false) {
        return {
          status: 'ingest-disabled',
          message: 'Ingestion is disabled in the plugin settings (Obsidian connection: allow ingest).',
        }
      }
      if (typeof args?.target !== 'string' || args.target.trim() === '') {
        throw new Error('obs_ingest: target is required')
      }
      try {
        return args.action === 'preflight' ? await runPreflight(args, cfg) : await runWrite(args, cfg)
      } catch (error) {
        return { status: 'error', message: errorMessage(error) }
      }
    },
  }
}

// Register the ingest tool. Returns the disposers; empty when the host has no
// tools service (direct unit-test callers). A registry rejection is reported
// and skipped so it cannot take the skill catalog down.
export function registerIngestTools(ctx, { getConfig } = {}) {
  if (typeof ctx?.tools?.register !== 'function') return []
  try {
    return [ctx.tools.register(ingestToolSpec({ getConfig }))]
  } catch (error) {
    console.warn('[dsh-learn-everything] ingest tool not registered: ' + errorMessage(error))
    return []
  }
}
