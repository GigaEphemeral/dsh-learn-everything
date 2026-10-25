// Native vault and compile tools: read-only vault queries plus explicit compile
// control, executed host-side so no skill builds OS-specific shell commands.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileToolSpec, registerVaultTools, vaultToolSpec } from '../src/tools/vault-tools.js'

const BASE = {
  apiKey: 'test-key',
  baseUrl: 'https://127.0.0.1:27124',
  compileStatusFile: '/nonexistent/compile-status.json',
}

function vaultSpec(overrides = {}) {
  return vaultToolSpec({ getConfig: () => ({ ...BASE, ...overrides }) })
}

function compileSpec(overrides = {}) {
  return compileToolSpec({ getConfig: () => ({ ...BASE, ...overrides }) })
}

test('obs_vault declares a registry-ready definition', () => {
  const tool = vaultSpec()
  assert.equal(tool.name, 'obs_vault')
  assert.equal(tool.parameters.type, 'object')
  assert.equal(typeof tool.output.render, 'function')
})

test('obs_vault rejects an unknown action', async () => {
  await assert.rejects(() => vaultSpec().execute({ action: 'delete' }), /action must be one of/)
})

test('obs_vault reports a missing API key instead of calling the vault', async () => {
  const out = await vaultSpec({ apiKey: '' }).execute({ action: 'search', query: 'x' })
  assert.equal(out.status, 'obsidian-not-configured')
  const node = await vaultSpec({ apiKey: '' }).execute({ action: 'node', name: 'x' })
  assert.equal(node.status, 'obsidian-not-configured')
})

test('obs_compile declares a registry-ready definition', () => {
  const tool = compileSpec()
  assert.equal(tool.name, 'obs_compile')
  assert.equal(typeof tool.output.render, 'function')
})

test('obs_compile rejects an unknown action', async () => {
  await assert.rejects(() => compileSpec().execute({ action: 'compile-now' }), /action must be one of/)
})

test('obs_compile status reads the local status file without a key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-compile-status-'))
  try {
    const tool = compileSpec({ apiKey: '', compileStatusFile: join(dir, 'compile-status.json') })
    const out = await tool.execute({ action: 'status' })
    assert.equal(out.status, 'ok')
    assert.equal(out.last, null)
    assert.deepEqual(out.stages, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('obs_compile trigger needs a path and a configured key', async () => {
  await assert.rejects(() => compileSpec().execute({ action: 'trigger' }), /path is required/)
  const out = await compileSpec({ apiKey: '' }).execute({ action: 'trigger', path: 'Sources/x.md' })
  assert.equal(out.status, 'obsidian-not-configured')
})

test('obs_compile pending needs a configured key', async () => {
  const out = await compileSpec({ apiKey: '' }).execute({ action: 'pending' })
  assert.equal(out.status, 'obsidian-not-configured')
})

test('registerVaultTools registers both tools and skips a host without tools', () => {
  const registered = []
  const disposers = registerVaultTools(
    { tools: { register: (tool) => { registered.push(tool); return () => {} } } },
    { getConfig: () => BASE },
  )
  assert.equal(disposers.length, 2)
  assert.deepEqual(registered.map((tool) => tool.name), ['obs_vault', 'obs_compile'])
  assert.equal(registerVaultTools({}, { getConfig: () => BASE }).length, 0)
})
