// R3: the Obsidian right-sidebar panel (plain JS to avoid esbuild TSX quirks).
// Fetches same-origin fenced routes (/obsidian/api/*) served by the plugin
// backend; the API key never reaches the browser. Notes render Markdown and
// scroll inside the pane; the graph iframe fetches its own data so the huge
// graph JSON never rides a request URL (which used to trigger HTTP 431).

import { createElement, useState, useEffect } from 'react'
import { routeErrorText } from '../sidebar/route-errors.js'
import { renderMarkdown } from '../markdown/render.js'

const DIRS = ['wiki/concepts', 'wiki/entities', 'wiki/sources', 'Sources']

// Vault name for obsidian:// deep links, read from /obsidian/api/config (default learnEverything).
let vaultName = 'learnEverything'
function openInObsidian(path) {
  return 'obsidian://open?vault=' + encodeURIComponent(vaultName) + '&file=' + encodeURIComponent(path)
}

// Preview typography. The panel runs inside the host page, so the rules are
// scoped to the preview class instead of restyling the page.
const MD_STYLE = `
.dsh-obsidian-md{color:#d7d7d7;font-size:13px;line-height:1.62;word-break:break-word}
.dsh-obsidian-md h1,.dsh-obsidian-md h2,.dsh-obsidian-md h3,
.dsh-obsidian-md h4,.dsh-obsidian-md h5,.dsh-obsidian-md h6{margin:14px 0 8px;line-height:1.3;color:#eee;font-weight:600}
.dsh-obsidian-md h1{font-size:20px;border-bottom:1px solid #333;padding-bottom:4px}
.dsh-obsidian-md h2{font-size:17px}
.dsh-obsidian-md h3{font-size:15px}
.dsh-obsidian-md p{margin:8px 0}
.dsh-obsidian-md a{color:#6cb6ff;text-decoration:none}
.dsh-obsidian-md a:hover{text-decoration:underline}
.dsh-obsidian-md .dsh-obsidian-wikilink{color:#8fd694;border-bottom:1px dashed #4b7a52}
.dsh-obsidian-md code{background:#2a2a2a;border:1px solid #3a3a3a;border-radius:3px;padding:1px 4px;font-size:12px}
.dsh-obsidian-md pre{background:#202020;border:1px solid #333;border-radius:4px;padding:10px;overflow-x:auto;margin:10px 0}
.dsh-obsidian-md pre code{background:none;border:0;padding:0;white-space:pre}
.dsh-obsidian-md blockquote{margin:10px 0;padding:2px 10px;border-left:3px solid #555;color:#aaa}
.dsh-obsidian-md ul,.dsh-obsidian-md ol{margin:8px 0;padding-left:22px}
.dsh-obsidian-md li{margin:3px 0}
.dsh-obsidian-md table{border-collapse:collapse;margin:10px 0;font-size:12px}
.dsh-obsidian-md th,.dsh-obsidian-md td{border:1px solid #444;padding:4px 8px}
.dsh-obsidian-md th{background:#2b2b2b}
.dsh-obsidian-md hr{border:0;border-top:1px solid #3a3a3a;margin:14px 0}
.dsh-obsidian-md img{max-width:100%;border-radius:4px}
`

function apiUrl(path, params) {
  // Routes are absolute (/obsidian/...); document.baseURI would append the
  // current session route or token query to every panel request.
  const base = window.location.origin
  const qs = new URLSearchParams(params).toString()
  return base + path + (qs ? '?' + qs : '')
}

async function getJson(url) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    let body = null
    try { body = await res.json() } catch { /* non-JSON error body */ }
    if (!res.ok || body?.ok === false) {
      return { ok: false, error: body?.error ?? { code: 'http-' + res.status, message: 'HTTP ' + res.status } }
    }
    return body ?? { ok: false, error: { code: 'empty', message: 'empty response' } }
  } catch (err) {
    return { ok: false, error: { code: 'network', message: String(err) } }
  }
}

// User-facing explanation for the route envelopes (missing key, host fence,
// backend failure). The key itself never reaches the browser.
function errorText(j) {
  return routeErrorText(j?.error)
}

function ErrorBanner(props) {
  if (!props.text) return null
  return createElement('div', {
    style: {
      margin: '8px', padding: '6px 8px', borderRadius: 4, fontSize: 12,
      background: '#3a2323', color: '#ffb4b4', border: '1px solid #5a2a2a',
    },
  }, props.text)
}

function DirList(props) {
  const onOpen = props.onOpen
  const [lists, setLists] = useState({})
  const [error, setError] = useState('')
  useEffect(() => {
    let ignore = false
    Promise.all(DIRS.map((dir) => getJson(apiUrl('/obsidian/api/list', { dir })).then((result) => ({ dir, result }))))
      .then((answers) => {
        if (ignore) return
        const next = {}
        const errors = []
        for (const { dir, result } of answers) {
          if (result.ok && Array.isArray(result.value?.files)) next[dir] = result.value.files
          else errors.push(errorText(result))
        }
        setLists(next)
        setError(errors[0] ?? '')
      })
    return () => { ignore = true }
  }, [])
  return createElement('div', { style: { padding: 8, fontSize: 13 } },
    createElement(ErrorBanner, { text: error }),
    ...DIRS.map((dir) =>
      createElement('div', { key: dir, style: { marginBottom: 10 } },
        createElement('b', null, dir),
        (lists[dir] ?? []).map((f) =>
          createElement('div', { key: dir + '/' + f, style: { paddingLeft: 10, cursor: 'pointer', color: '#6cb6ff' } },
            createElement('a', { href: '#', onClick: (e) => { e.preventDefault(); onOpen(dir + '/' + f) } }, f)
          )
        ),
      )
    ),
  )
}

function SearchView(props) {
  const onOpen = props.onOpen
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [error, setError] = useState('')
  const run = () => {
    const query = q.trim()
    if (!query) return
    setError('')
    getJson(apiUrl('/obsidian/api/search', { q: query })).then((j) => {
      if (j.ok) setResults(j.value?.results ?? [])
      else setError(errorText(j))
    })
  }
  return createElement('div', { style: { padding: 8, fontSize: 13 } },
    createElement(ErrorBanner, { text: error }),
    createElement('input', { value: q, placeholder: '搜索知识库…', onChange: (e) => setQ(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') run() }, style: { width: '100%', boxSizing: 'border-box', padding: 4 } }),
    createElement('button', { onClick: run, style: { marginTop: 4 } }, '搜索'),
    results.map((r) =>
      createElement('div', { key: r.path, style: { padding: 4, cursor: 'pointer', color: '#6cb6ff' } },
        createElement('a', { href: '#', onClick: (e) => { e.preventDefault(); onOpen(r.path) } }, r.path + ' — ' + String(r.excerpt ?? '').slice(0, 60))
      )
    ),
  )
}

function NoteView(props) {
  const path = props.path
  const onBack = props.onBack
  const [content, setContent] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    // A slow read for the previous note must not overwrite the newly selected
    // one, and a closed tab must not receive state updates.
    let ignore = false
    setContent(null)
    setError('')
    getJson(apiUrl('/obsidian/api/read', { path })).then((j) => {
      if (ignore) return
      if (j.ok) setContent(j.value?.content ?? '')
      else setError(errorText(j))
    })
    return () => { ignore = true }
  }, [path])
  // Wikilinks rendered by the preview navigate inside the panel; external
  // links keep the browser's own behavior.
  const onPreviewClick = (event) => {
    const link = event.target?.closest?.('[data-wikilink]')
    if (!link) return
    event.preventDefault()
    const next = link.getAttribute('data-wikilink')
    if (next) props.onOpen(next)
  }
  return createElement('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
    createElement('div', { style: { padding: '8px', borderBottom: '1px solid #2c2c2c', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 } },
      createElement('button', { onClick: onBack, style: { flexShrink: 0 } }, '← 返回'),
      createElement('span', { title: path, style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: '#aaa' } }, path),
      createElement('a', { href: openInObsidian(path), style: { flexShrink: 0, color: '#6cb6ff', fontSize: 12 } }, '在 Obsidian 打开'),
    ),
    createElement('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 14px' } },
      createElement('style', null, MD_STYLE),
      content === null
        ? createElement('div', { style: { padding: '10px 0', color: '#888', fontSize: 12 } }, error ? null : '加载中…')
        : createElement('div', {
          className: 'dsh-obsidian-md',
          onClick: onPreviewClick,
          dangerouslySetInnerHTML: { __html: renderMarkdown(content) },
        }),
      createElement(ErrorBanner, { text: error }),
    ),
  )
}

function GraphView() {
  // The graph page fetches /obsidian/graph itself: passing the whole graph
  // through ?data= exceeded the host's request-line limit (HTTP 431).
  return createElement('div', { style: { flex: 1, minHeight: 0, padding: 8, boxSizing: 'border-box' } },
    createElement('iframe', {
      src: apiUrl('/obsidian/graph-page'),
      title: '知识图谱',
      style: { width: '100%', height: '100%', minHeight: 420, border: 0, borderRadius: 6, background: '#1e1e1e' },
    }),
  )
}

function TestConnection() {
  const [state, setState] = useState({ busy: false, result: null })
  const test = () => {
    setState({ busy: true, result: null })
    getJson(apiUrl('/obsidian/api/test-connection')).then((j) => {
      if (j.ok && j.value?.connected) {
        setState({ busy: false, result: { ok: true, text: '已连通 (' + j.value.latency + ' ms)' } })
      } else {
        const e = j.value?.error
        setState({ busy: false, result: { ok: false, text: '连接失败: ' + (e?.code ?? 'unknown') + ' ' + (e?.message ?? '') } })
      }
    }).catch(() => setState({ busy: false, result: { ok: false, text: '连接失败: 请求错误' } }))
  }
  return createElement('div', { style: { padding: 8, fontSize: 12, borderTop: '1px solid #2c2c2c' } },
    createElement('button', { onClick: test, disabled: state.busy, style: { marginRight: 6 } }, state.busy ? '测试中…' : '测试连接'),
    state.result && createElement('span', { style: { color: state.result.ok ? '#4caf50' : '#ff6b6b' } }, state.result.text),
  )
}

function StatusView() {
  const [status, setStatus] = useState('—')
  useEffect(() => {
    // keepMounted tabs do not remount: poll so a finished compile becomes visible.
    let ignore = false
    const load = () => {
      getJson(apiUrl('/obsidian/compile-status')).then((j) => {
        if (ignore) return
        if (j.ok && j.value?.last) {
          const last = j.value.last
          setStatus(last.stage + (last.source ? ' · ' + last.source : '') + ' · ' + (last.at ?? ''))
        } else if (!j.ok) {
          setStatus('不可用')
        }
      })
    }
    load()
    const timer = setInterval(load, 5000)
    return () => { ignore = true; clearInterval(timer) }
  }, [])
  return createElement('div', { style: { padding: '6px 8px', borderTop: '1px solid #2c2c2c', fontSize: 11, color: '#888', flexShrink: 0 } }, '编译: ' + status)
}

export function ObsidianPanel(props) {
  const [view, setView] = useState({ kind: 'dirs' })
  useEffect(() => {
    getJson(apiUrl('/obsidian/api/config')).then((j) => {
      if (j.ok && j.value?.vaultName) vaultName = j.value.vaultName
    })
  }, [])
  const nav = (label, kind) => createElement('button', { onClick: () => setView(kind), style: { marginRight: 6 } }, label)
  const openNote = (path) => setView({ kind: 'note', path })
  // Notes and the graph own their scroll containers; lists scroll in the body.
  const bodyStyle = view.kind === 'note' || view.kind === 'graph'
    ? { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }
    : { flex: 1, minHeight: 0, overflowY: 'auto' }
  return createElement('div', { style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', fontFamily: '-apple-system, Segoe UI, sans-serif', color: '#ddd' } },
    createElement('div', { style: { padding: 8, borderBottom: '1px solid #2c2c2c', flexShrink: 0 } },
      nav('目录', { kind: 'dirs' }), nav('搜索', { kind: 'search' }), nav('图谱', { kind: 'graph' }),
    ),
    createElement('div', { style: bodyStyle },
      view.kind === 'dirs' && createElement(DirList, { onOpen: openNote }),
      view.kind === 'search' && createElement(SearchView, { onOpen: openNote }),
      view.kind === 'graph' && createElement(GraphView),
      view.kind === 'note' && createElement(NoteView, { path: view.path, onBack: () => setView({ kind: 'dirs' }), onOpen: openNote }),
    ),
    createElement(StatusView),
  )
}
