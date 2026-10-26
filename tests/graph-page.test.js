// Regression tests for the graph page and note preview plumbing (S4).
// The graph must fetch its own data (a ?data= payload caused HTTP 431), the
// library is served self-hosted, the note preview owns a scroll container, and
// both the panel and the graph page must follow the host light/dark theme
// instead of painting hardcoded dark colors on a light background.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { makeRouteHandlers } from '../src/sidebar/routes.js'

// Colors the panel used before the theme fix: dark-theme literals that made
// text unreadable on the light host background.
const LEGACY_DARK_COLORS = [
  '#d7d7d7', '#ddd', '#eee', '#6cb6ff', '#8fd694', '#4b7a52', '#2a2a2a',
  '#3a3a3a', '#202020', '#333', '#555', '#aaa', '#888', '#2c2c2c', '#2b2b2b',
  '#444', '#ffb4b4', '#5a2a2a', '#3a2323', '#4caf50', '#ff6b6b', '#1e1e1e',
]

test('graph page fetches its own data instead of taking it via the URL', async () => {
  const html = await readFile(new URL('../panel/graph.html', import.meta.url), 'utf8')
  assert.equal(html.includes('unpkg.com'), false)
  assert.equal(html.includes('./vis-network.min.js'), true)
  assert.match(html, /fetch\(new URL\('graph', location\.href\)/)
  assert.equal(html.includes('params.get("data")'), false)
  assert.equal(html.includes("params.get('data')"), false)
  assert.equal((html.match(/addEventListener\('message'/g) ?? []).length, 1, 'the message listener is registered once at page scope')
  assert.match(html, /network\.setData/)
  assert.match(html, /event\.origin !== location\.origin/)
})

test('graph page carries a light/dark palette and resolves the theme from the URL', async () => {
  const html = await readFile(new URL('../panel/graph.html', import.meta.url), 'utf8')
  // Light is the default palette; the dark override is driven by data-theme.
  assert.match(html, /:root\{/)
  assert.match(html, /html\[data-theme='dark'\]\{/)
  for (const token of [
    '--graph-bg', '--graph-fg', '--graph-muted', '--graph-line', '--graph-panel',
    '--graph-link', '--graph-button-bg', '--graph-button-fg', '--graph-status-error',
  ]) {
    assert.equal(html.includes(token), true, 'missing palette token ' + token)
  }
  // No hardcoded dark page background and no fixed node label color.
  assert.equal(html.includes('#1e1e1e'), false, 'the page background must come from the palette')
  assert.equal(html.includes('#ddd'), false, 'the node label color must come from the palette')
  // The panel passes ?theme=; without it the page reads the same-origin parent.
  assert.match(html, /new URLSearchParams\(location\.search\)/)
  assert.match(html, /params\.get\('theme'\)/)
  assert.match(html, /document\.documentElement\.dataset\.theme = resolveTheme\(\)/)
  assert.match(html, /data-ds-dark-theme/)
  // vis-network paints on a canvas, so its colors come from computed CSS props.
  assert.match(html, /getComputedStyle\(document\.documentElement\)/)
  assert.match(html, /font: \{ color: palette\.label, size: 13 \}/)
  assert.match(html, /color: \{ color: palette\.line, highlight: palette\.link \}/)
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
  assert.match(source, /apiUrl\('\/obsidian\/graph-page', \{ theme: graphPageTheme\(dark\) \}\)/)
  assert.equal(source.includes("apiUrl('/obsidian/graph-page', { data })"), false)
  // The note preview body owns its scroll container and renders Markdown.
  assert.match(source, /overflowY: 'auto'/)
  assert.match(source, /renderMarkdown\(content\)/)
  assert.match(source, /window\.location\.origin/)
  assert.match(source, /onChange:/)
  assert.match(source, /Promise\.all\(DIRS\.map/)
  assert.match(source, /let ignore = false/)
})

test('the panel re-renders the graph when the host theme flips', async () => {
  const source = await readFile(new URL('../src/client/ObsidianPanel.js', import.meta.url), 'utf8')
  assert.match(source, /import \{ isDarkDocument, graphPageTheme \} from '\.\/theme\.js'/)
  assert.match(source, /useState\(\(\) => isDarkDocument\(document\.body\)\)/)
  assert.match(source, /new MutationObserver/)
  assert.match(source, /attributeFilter: \['data-ds-dark-theme'\]/)
  assert.match(source, /observer\.disconnect\(\)/)
  assert.match(source, /data-ds-dark-theme/)
  assert.match(source, /var\(--dsw-alias-bg-base\)/)
})

test('the panel colors every surface with host theme tokens', async () => {
  const source = await readFile(new URL('../src/client/ObsidianPanel.js', import.meta.url), 'utf8')
  for (const token of [
    '--dsw-alias-label-primary',
    '--dsw-alias-label-secondary',
    '--dsw-alias-label-tertiary',
    '--dsw-alias-border-l2',
    '--dsw-alias-border-l3',
    '--dsw-alias-link',
    '--dsw-alias-state-success-primary',
    '--dsw-alias-state-error-primary',
    '--dsw-alias-markdown-inline-code',
    '--dsw-alias-markdown-code-block',
    '--dsw-alias-markdown-code-block-banner',
    '--dsw-alias-interactive-bg-hover-solid',
  ]) {
    assert.equal(source.includes(token), true, 'missing host token ' + token)
  }
  // The error banner derives its tint from the state-error token.
  assert.match(source, /color-mix\(in srgb, var\(--dsw-alias-state-error-primary\) 12%/)
  for (const literal of LEGACY_DARK_COLORS) {
    assert.equal(source.includes(literal), false, 'hardcoded dark color ' + literal + ' returned to the panel')
  }
})
