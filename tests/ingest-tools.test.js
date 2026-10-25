// Native ingest tool: the settings switch, confirmation gate and content-hash
// guard are enforced host-side, so a skill can never write without the user's
// explicit confirmation and never needs a shell command.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ingestToolSpec, registerIngestTools } from '../src/tools/ingest-tools.js'

const BASE = { apiKey: 'test-key', baseUrl: 'https://127.0.0.1:27124', ingest: true }

function spec(overrides = {}) {
  return ingestToolSpec({ getConfig: () => ({ ...BASE, ...overrides }) })
}

test('obs_ingest declares a registry-ready definition', () => {
  const tool = spec()
  assert.equal(tool.name, 'obs_ingest')
  assert.equal(tool.parameters.type, 'object')
  assert.equal(typeof tool.output.render, 'function')
  assert.equal(typeof tool.execute, 'function')
})

test('obs_ingest rejects an unknown action', async () => {
  await assert.rejects(() => spec().execute({ action: 'nuke', target: 'x.md' }),
    /action must be "preflight" or "write"/)
})

test('obs_ingest reports a missing API key instead of writing', async () => {
  const out = await spec({ apiKey: '' }).execute({ action: 'write', target: 'x.md', confirm: true })
  assert.equal(out.status, 'obsidian-not-configured')
})

test('obs_ingest refuses writes while the settings switch is off', async () => {
  const out = await spec({ ingest: false }).execute({ action: 'write', target: 'x.md', confirm: true })
  assert.equal(out.status, 'ingest-disabled')
})

test('obs_ingest keeps preflight usable while the switch is off', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ingest-off-'))
  try {
    // A missing local file must surface as an acquisition error, not as the
    // switch refusal: preflight stays read-only when ingest is disabled.
    const out = await spec({ ingest: false }).execute({ action: 'preflight', target: join(dir, 'missing.md') })
    assert.equal(out.status, 'error')
    assert.notEqual(out.status, 'ingest-disabled')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('obs_ingest requires confirm: true before any write work', async () => {
  const out = await spec().execute({ action: 'write', target: 'x.md' })
  assert.equal(out.status, 'confirmation-required')
})

test('obs_ingest refuses to write when the source changed since preflight', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ingest-hash-'))
  try {
    const file = join(dir, 'note.md')
    await writeFile(file, '# note\n', 'utf8')
    const out = await spec().execute({ action: 'write', target: file, confirm: true, expectedHash: 'deadbeef' })
    assert.equal(out.status, 'source-changed')
    assert.equal(out.expectedHash, 'deadbeef')
    assert.notEqual(out.actualHash, 'deadbeef')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('obs_ingest refuses a directory outside Sources', async () => {
  const out = await spec().execute({ action: 'preflight', target: 'x.md', dir: 'wiki/notes' })
  assert.equal(out.status, 'error')
  assert.match(out.message, /must stay under "Sources\//)
})

test('registerIngestTools registers one tool and skips a host without tools', () => {
  const registered = []
  const disposers = registerIngestTools(
    { tools: { register: (tool) => { registered.push(tool); return () => {} } } },
    { getConfig: () => BASE },
  )
  assert.equal(disposers.length, 1)
  assert.equal(registered[0].name, 'obs_ingest')
  assert.equal(registerIngestTools({}, { getConfig: () => BASE }).length, 0)
})
