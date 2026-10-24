// Regression tests for the graph page and note preview plumbing (S4).
// The graph must fetch its own data (a ?data= payload caused HTTP 431), the
// library is served self-hosted, and the note preview owns a scroll container.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { makeRouteHandlers } from '../src/sidebar/routes.js'

test('graph page fetches its own data instead of taking it via the URL', async () => {
  const html = await readFile(new URL('../panel/graph.html', import.meta.url), 'utf8')
  assert.equal(html.includes('unpkg.com'), false)
  assert.equal(html.includes('./vis-network.min.js'), true)
  assert.match(html, /fetch\(new URL\('graph', location\.href\)/)
  assert.equal(html.includes('params.get("data")'), false)
  assert.equal(html.includes("params.get('data')"), false)
})

test('the graph library is present and served as JavaScript', async () => {
  const library = await readFile(new URL('../panel/vis-network.min.js', import.meta.url))
  assert.ok(library.length > 500_000, 'vendored vis-network is unexpectedly small')
  let body = ''
  const res = {
    statusCode: 0,
    headers: {},
    writeHead(status, headers) { this.statusCode = status; this.headers = headers ?? {} },
    end(chunk) { body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '') },
  }
  const handlers = makeRouteHandlers({})
  await handlers.graphLib({ url: '/obsidian/vis-network.min.js', method: 'GET', headers: {} }, res)
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['content-type'], /javascript/)
  assert.ok(body.length > 500_000)
  assert.match(body, /vis-network/)
})

test('the panel embeds the graph page without a data query and scrolls notes', async () => {
  const source = await readFile(new URL('../src/client/ObsidianPanel.js', import.meta.url), 'utf8')
  assert.match(source, /apiUrl\('\/obsidian\/graph-page'\)/)
  assert.equal(source.includes("apiUrl('/obsidian/graph-page', { data })"), false)
  // The note preview body owns its scroll container and renders Markdown.
  assert.match(source, /overflowY: 'auto'/)
  assert.match(source, /renderMarkdown\(content\)/)
})
