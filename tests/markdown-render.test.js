// Unit tests for the Obsidian note Markdown renderer (S4).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeHtml, renderInline, renderMarkdown } from '../src/markdown/render.js'

test('renders headings, paragraphs, emphasis, and inline code', () => {
  const html = renderMarkdown('# Title\n\nSome **bold** and *italic* and `code`.\n\n- one\n- two')
  assert.equal(html.includes('<h1>Title</h1>'), true)
  assert.equal(html.includes('<strong>bold</strong>'), true)
  assert.equal(html.includes('<em>italic</em>'), true)
  assert.equal(html.includes('<code>code</code>'), true)
  assert.equal(html.includes('<ul><li>one</li><li>two</li></ul>'), true)
})

test('a raw HTML script is escaped, never emitted as markup', () => {
  const html = renderMarkdown('<script>alert(1)</script>')
  assert.equal(html.includes('<script>'), false)
  assert.equal(html.includes('&lt;script&gt;'), true)
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
})

test('unsafe link and image URLs degrade to #', () => {
  const html = renderMarkdown('[click](javascript:alert(1)) ![x](data:text/html,hi)')
  assert.equal(html.includes('javascript:'), false)
  assert.equal(html.includes('data:text/html'), false)
  assert.equal((html.match(/href="#"/g) ?? []).length >= 1, true)
})

test('fenced code keeps its content escaped and adds a language class', () => {
  const html = renderMarkdown('```js\nconst x = "<tag>"\n```')
  assert.equal(html.includes('<pre><code class="language-js">'), true)
  assert.equal(html.includes('&quot;'), true)
  assert.equal(html.includes('<tag>'), false)
})

test('renders blockquotes, tables, and horizontal rules', () => {
  const html = renderMarkdown('> quoted\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n---')
  assert.equal(html.includes('<blockquote><p>quoted</p></blockquote>'), true)
  assert.equal(html.includes('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'), true)
  assert.equal(html.includes('<hr>'), true)
})

test('Obsidian wikilinks resolve to vault paths for in-panel navigation', () => {
  const html = renderInline('see [[concepts/cordis-patch|Cordis patch]]')
  assert.equal(html.includes('data-wikilink="wiki/concepts/cordis-patch.md"'), true)
  assert.equal(html.includes('>Cordis patch</a>'), true)
})

test('normalizes CRLF and preserves soft line breaks inside a paragraph', () => {
  const html = renderMarkdown('line one\r\nline two')
  assert.equal(html, '<p>line one<br>line two</p>')
})
