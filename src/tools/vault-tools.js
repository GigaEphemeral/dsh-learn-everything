// Native vault and compile tools (obs_vault, obs_compile). Read-only vault
// operations plus an explicit compile trigger, all executed by the host so no
// skill has to run node scripts or build OS-specific paths.

import { ObsidianClient, ObsidianAdapter } from '../obsidian/obsidian-adapter.js'
import { McpClient } from '../obsidian/mcp-client.js'
import { readCompileStatus } from '../obsidian/compile-status.js'
import { KarpathyDriver } from '../wiki/karpathy-driver.js'
import { pendingSources, recordCompileEvent } from '../wiki/compile-queue.js'
import { SearchRetriever } from '../search/retriever.js'
import { classifyIntent, INTENT } from '../search/intent.js'
import { assessSufficiency } from '../search/evidence.js'
import { contextNode } from '../../scripts/wiki-node-cli.mjs'
import { collectGraph } from '../../scripts/wiki-graph.mjs'

const VAULT_ACTIONS = ['search', 'node', 'graph']
const COMPILE_ACTIONS = ['status', 'pending', 'trigger']

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

function adapterFor(cfg) {
  return new ObsidianAdapter(new ObsidianClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey }))
}

function requireKey(cfg) {
  return cfg.apiKey ? null : { status: 'obsidian-not-configured', message: 'Configure the Obsidian API key in the plugin settings first.' }
}

async function search(args, cfg) {
  const query = args.query.trim()
  const retriever = new SearchRetriever({ adapter: adapterFor(cfg) })
  const intent = classifyIntent(query)
  if (intent === INTENT.structure) {
    return { status: 'ok', intent, structural: await retriever.structural(query) }
  }
  const results = await retriever.wikiFirst(query)
  const sufficiency = assessSufficiency(query, results, { exactFact: intent === INTENT.source })
  return { status: 'ok', intent, sufficiency, results }
}

async function node(args, cfg) {
  const name = args.name.trim()
  return { status: 'ok', node: await contextNode(adapterFor(cfg), name) }
}

async function graph(cfg) {
  return { status: 'ok', graph: await collectGraph(adapterFor(cfg)) }
}

async function compile(args, cfg) {
  if (args.action === 'status') {
    const status = await readCompileStatus(cfg.compileStatusFile)
    const result = { status: 'ok', last: status.last, stages: status.stages }
    if (typeof args.path === 'string' && args.path.trim() !== '') {
      if (!cfg.apiKey) return { ...result, path: args.path, compiled: null, note: 'configure the API key to check the vault' }
      const pending = await pendingSources(adapterFor(cfg))
      result.path = args.path.trim()
      result.compiled = !pending.includes(result.path)
    }
    return result
  }
  if (args.action === 'pending') {
    const missing = requireKey(cfg)
    if (missing) return missing
    return { status: 'ok', pending: await pendingSources(adapterFor(cfg)) }
  }
  // action === 'trigger'
  const missing = requireKey(cfg)
  if (missing) return missing
  const filePath = args.path.trim()
  const adapter = adapterFor(cfg)
  const driver = new KarpathyDriver({ adapter, mcp: new McpClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey }) })
  await recordCompileEvent(cfg.compileStatusFile, { stage: 'triggered', source: filePath })
  const snapshot = await driver.snapshotWiki()
  await recordCompileEvent(cfg.compileStatusFile, { stage: 'waiting', source: filePath })
  await driver.openAndIngest(filePath)
  return {
    status: 'triggered',
    path: filePath,
    hint: 'Compile runs 6-15 minutes and may be rate-limited. Poll action "status" with the same path instead of retriggering.',
  }
}

/** Registry-ready definition for obs_vault. */
export function vaultToolSpec({ getConfig } = {}) {
  return {
    name: 'obs_vault',
    description: 'Read-only Obsidian vault queries: action "search" classifies the intent and returns evidence with a sufficiency verdict; "node" shows one wiki node with its source notes and learning summary; "graph" returns the wiki link graph.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: VAULT_ACTIONS, description: 'search, node or graph.' },
        query: { type: 'string', description: 'Search text for action "search".' },
        name: { type: 'string', description: 'Node name for action "node" (use "random" for a random node).' },
      },
      required: ['action'],
    },
    output: OUTPUT,
    timeoutMs: 120000,
    execute: async (args) => {
      const cfg = configured(getConfig)
      if (!VAULT_ACTIONS.includes(args?.action)) {
        throw new Error('obs_vault: action must be one of ' + VAULT_ACTIONS.join(', '))
      }
      const missing = requireKey(cfg)
      if (missing) return missing
      if (args.action === 'search' && (typeof args.query !== 'string' || args.query.trim() === '')) {
        throw new Error('obs_vault: query is required for action "search"')
      }
      if (args.action === 'node' && (typeof args.name !== 'string' || args.name.trim() === '')) {
        throw new Error('obs_vault: name is required for action "node"')
      }
      try {
        if (args.action === 'search') return await search(args, cfg)
        if (args.action === 'node') return await node(args, cfg)
        return await graph(cfg)
      } catch (error) {
        return { status: 'error', message: errorMessage(error) }
      }
    },
  }
}

/** Registry-ready definition for obs_compile. */
export function compileToolSpec({ getConfig } = {}) {
  return {
    name: 'obs_compile',
    description: 'karpathywiki compile control: "status" reads the local compile-progress file (and, given a path, whether its wiki page exists); "pending" lists sources without a wiki page; "trigger" starts one explicit compile and returns immediately (poll "status"; never retrigger in a burst).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: COMPILE_ACTIONS, description: 'status, pending or trigger.' },
        path: { type: 'string', description: 'Source note path such as Sources/foo.md (status with a path, or trigger).' },
      },
      required: ['action'],
    },
    output: OUTPUT,
    timeoutMs: 180000,
    execute: async (args) => {
      const cfg = configured(getConfig)
      if (!COMPILE_ACTIONS.includes(args?.action)) {
        throw new Error('obs_compile: action must be one of ' + COMPILE_ACTIONS.join(', '))
      }
      if (args.action === 'trigger' && (typeof args.path !== 'string' || args.path.trim() === '')) {
        throw new Error('obs_compile: path is required for action "trigger"')
      }
      try {
        return await compile(args, cfg)
      } catch (error) {
        return { status: 'error', message: errorMessage(error) }
      }
    },
  }
}

/** Register obs_vault and obs_compile; empty list without a tools service. */
export function registerVaultTools(ctx, { getConfig } = {}) {
  if (typeof ctx?.tools?.register !== 'function') return []
  const disposers = []
  for (const spec of [vaultToolSpec({ getConfig }), compileToolSpec({ getConfig })]) {
    try {
      disposers.push(ctx.tools.register(spec))
    } catch (error) {
      console.warn('[dsh-learn-everything] ' + spec.name + ' not registered: ' + errorMessage(error))
    }
  }
  return disposers
}
