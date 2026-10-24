// Minimal, dependency-free Markdown renderer for the Obsidian note preview
// (S4). Obsidian's REST API serves raw Markdown, so the panel renders it here.
//
// Safety pipeline: the whole line is HTML-escaped once; code spans, links,
// images, and wikilinks are then lifted into opaque placeholders; emphasis is
// applied only to the remaining text; finally the safe HTML stored for each
// placeholder is restored. Later passes therefore never rewrite markup
// produced by earlier passes (which could inject attribute-breaking tags).
// Supported: headings, paragraphs, emphasis, inline/fenced code, lists,
// blockquotes, tables, rules, links, images, and Obsidian wikilinks.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const PLACEHOLDER_RE = /\uE000(\d+)\uE001/g

/** Escape the five HTML-significant characters. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ESCAPES[character])
}

// Only these URL shapes may become href/src; everything else (javascript:,
// data:, unrecognized schemes) degrades to '#'. The value is already escaped
// by renderInline, so it must not be escaped a second time.
function safeUrl(encoded) {
  const url = encoded.trim()
  if (/^(https?:|mailto:|obsidian:|#|\/|\.\/|\.\.\/)/i.test(url)) return url
  return '#'
}

// [[concepts/a|label]] addresses a vault note. Wiki dirs get the wiki/ prefix;
// top-level vault folders (Sources, Learning, already wiki/) stay absolute.
// A heading/block anchor is dropped: the read route addresses whole notes.
function wikilinkPath(target) {
  const note = target.split('#')[0].split('^')[0].trim()
  if (!note || /^[a-z][a-z0-9+.-]*:/i.test(note)) return null
  if (/^wiki\//.test(note) || /^(Sources|Learning)\//.test(note)) return note
  if (/^(concepts|entities|sources)\//.test(note)) return 'wiki/' + note
  if (!note.includes('/')) return 'wiki/' + note
  return note
}

function wikilink(target, label) {
  const path = wikilinkPath(target)
  if (path === null) return label ?? target
  return `<a href="#" class="dsh-obsidian-wikilink" data-wikilink="${path}.md">${label ?? target}</a>`
}

/** Tokenize links/images/wikilinks/code into placeholders so emphasis cannot touch them. */
function tokenizeInline(escaped) {
  const tokens = []
  const keep = (html) => `\uE000${tokens.push(html) - 1}\uE001`
  let text = escaped
  text = text.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`))
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_, alt, url) => keep(`<img alt="${alt}" src="${safeUrl(url)}" loading="lazy">`))
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, label, url) => keep(`<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`))
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => keep(wikilink(target, label)))
  return { text, tokens }
}

function emphasize(text) {
  let result = text
  result = result.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  result = result.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
  result = result.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  result = result.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')
  result = result.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
  return result
}

/** Render one line's inline Markdown. */
export function renderInline(value) {
  const { text, tokens } = tokenizeInline(escapeHtml(value))
  return emphasize(text).replace(PLACEHOLDER_RE, (_, index) => tokens[Number(index)] ?? '')
}

function splitCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function isTableStart(lines, index) {
  if (index + 1 >= lines.length || !lines[index].includes('|')) return false
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
}

function renderTable(lines, start) {
  const header = splitCells(lines[start])
  const rows = []
  let index = start + 2
  while (index < lines.length && lines[index].includes('|') && !/^\s*$/.test(lines[index])) {
    rows.push(splitCells(lines[index]))
    index += 1
  }
  const head = header.map((cell) => `<th>${renderInline(cell)}</th>`).join('')
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`).join('')
  return { html: `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`, next: index }
}

function renderList(lines, start) {
  const ordered = /^\s*\d/.test(lines[start])
  const items = []
  let index = start
  while (index < lines.length) {
    const match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index])
    if (!match) {
      // An indented continuation line belongs to the previous item.
      if (items.length > 0 && /^\s{2,}\S/.test(lines[index])) {
        items[items.length - 1] += ' ' + lines[index].trim()
        index += 1
        continue
      }
      break
    }
    items.push(match[3])
    index += 1
  }
  const tag = ordered ? 'ol' : 'ul'
  const html = `<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`
  return { html, next: index }
}

function renderFence(lines, start) {
  const opening = /^\s*```(\w*)\s*$/.exec(lines[start])
  const language = opening?.[1] ?? ''
  const code = []
  let index = start + 1
  while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
    code.push(lines[index])
    index += 1
  }
  if (index < lines.length) index += 1
  const className = language ? ` class="language-${escapeHtml(language)}"` : ''
  return { html: `<pre><code${className}>${escapeHtml(code.join('\n'))}</code></pre>`, next: index }
}

// A leading YAML frontmatter block is metadata, not note body.
function stripFrontmatter(source) {
  const normalized = String(source ?? '').replace(/\r\n?/g, '\n')
  if (!normalized.startsWith('---\n')) return normalized
  const end = normalized.indexOf('\n---', 4)
  if (end === -1) return normalized
  const after = normalized.slice(end + 4)
  return after.startsWith('\n') ? after.slice(1) : after
}

/**
 * Render a Markdown document to safe HTML.
 * @param source - raw Markdown text (Obsidian note content).
 * @returns HTML for a scrollable preview container.
 */
export function renderMarkdown(source) {
  const lines = stripFrontmatter(source).split('\n')
  const blocks = []
  const paragraph = []
  const flush = () => {
    if (paragraph.length === 0) return
    blocks.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`)
    paragraph.length = 0
  }

  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (/^\s*$/.test(line)) {
      flush()
      index += 1
      continue
    }
    if (/^\s*```/.test(line)) {
      flush()
      const fence = renderFence(lines, index)
      blocks.push(fence.html)
      index = fence.next
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      const level = heading[1].length
      const text = renderInline(heading[2].replace(/\s+#+\s*$/, ''))
      blocks.push(`<h${level}>${text}</h${level}>`)
      index += 1
      continue
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flush()
      blocks.push('<hr>')
      index += 1
      continue
    }
    if (/^\s*>/.test(line)) {
      flush()
      const quoted = []
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`)
      continue
    }
    if (isTableStart(lines, index)) {
      flush()
      const table = renderTable(lines, index)
      blocks.push(table.html)
      index = table.next
      continue
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flush()
      const list = renderList(lines, index)
      blocks.push(list.html)
      index = list.next
      continue
    }
    paragraph.push(line.trim())
    index += 1
  }
  flush()
  return blocks.join('\n')
}
