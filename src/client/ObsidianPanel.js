// R3: the Obsidian right-sidebar panel (plain JS to avoid esbuild TSX quirks).
// Fetches same-origin fenced routes (/obsidian/api/*) served by the plugin
// backend; the API key never reaches the browser.

import { createElement, useState, useEffect } from 'react'
import { routeErrorText } from '../sidebar/route-errors.js'

const DIRS = ['wiki/concepts', 'wiki/entities', 'wiki/sources', 'Sources']

function apiUrl(path, params) {
  const base = (document.baseURI ?? window.location.href).replace(/\/$/, '')
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
    for (const dir of DIRS) {
      getJson(apiUrl('/obsidian/api/list', { dir })).then((j) => {
        if (j.ok && Array.isArray(j.value?.files)) {
          setLists((prev) => Object.assign({}, prev, { [dir]: j.value.files }))
        } else if (!j.ok) {
          setError(errorText(j))
        }
      })
    }
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
    if (!q.trim()) return
    setError('')
    getJson(apiUrl('/obsidian/api/search', { q })).then((j) => {
      if (j.ok) setResults(j.value?.results ?? [])
      else setError(errorText(j))
    })
  }
  return createElement('div', { style: { padding: 8, fontSize: 13 } },
    createElement(ErrorBanner, { text: error }),
    createElement('input', { value: q, placeholder: '搜索知识库…', onInput: (e) => setQ(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') run() }, style: { width: '100%', boxSizing: 'border-box', padding: 4 } }),
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
  const [content, setContent] = useState('')
  useEffect(() => {
    getJson(apiUrl('/obsidian/api/read', { path })).then((j) => {
      if (j.ok) setContent(j.value?.content ?? '(empty)')
      else setContent(errorText(j))
    })
  }, [path])
  return createElement('div', { style: { padding: 8, fontSize: 12 } },
    createElement('button', { onClick: onBack }, '← 返回'),
    createElement('div', { style: { marginTop: 6 } },
      path,
      createElement('a', { href: 'obsidian://open?vault=learnEverything&file=' + encodeURIComponent(path), style: { marginLeft: 8 } }, '在 Obsidian 打开'),
    ),
    createElement('pre', { style: { whiteSpace: 'pre-wrap', marginTop: 6 } }, String(content).slice(0, 3000)),
  )
}

function GraphView() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    getJson(apiUrl('/obsidian/graph')).then((j) => {
      if (j.ok) setData(encodeURIComponent(JSON.stringify(j.value)))
      else setError(errorText(j))
    })
  }, [])
  return createElement('div', { style: { padding: 8 } },
    createElement(ErrorBanner, { text: error }),
    data === null
      ? createElement('span', null, error ? '图谱不可用' : '图谱加载中…')
      : createElement('iframe', { src: apiUrl('/obsidian/graph-page', { data }), style: { width: '100%', height: 520, border: 0, borderRadius: 6 } }),
  )
}

function StatusView() {
  const [status, setStatus] = useState('—')
  useEffect(() => {
    getJson(apiUrl('/obsidian/compile-status')).then((j) => {
      if (j.ok && j.value?.last) {
        const last = j.value.last
        setStatus(last.stage + (last.source ? ' · ' + last.source : '') + ' · ' + (last.at ?? ''))
      }
    })
  }, [])
  return createElement('div', { style: { padding: 8, fontSize: 12, color: '#888' } }, '编译: ' + status)
}

export function ObsidianPanel(props) {
  const [view, setView] = useState({ kind: 'dirs' })
  const nav = (label, kind) => createElement('button', { onClick: () => setView(kind), style: { marginRight: 6 } }, label)
  return createElement('div', { style: { fontFamily: '-apple-system, Segoe UI, sans-serif', color: '#ddd' } },
    createElement('div', { style: { padding: 8, borderBottom: '1px solid #333' } },
      nav('目录', { kind: 'dirs' }), nav('搜索', { kind: 'search' }), nav('图谱', { kind: 'graph' }),
    ),
    view.kind === 'dirs' && createElement(DirList, { onOpen: (path) => setView({ kind: 'note', path }) }),
    view.kind === 'search' && createElement(SearchView, { onOpen: (path) => setView({ kind: 'note', path }) }),
    view.kind === 'graph' && createElement(GraphView, null),
    view.kind === 'note' && createElement(NoteView, { path: view.path, onBack: () => setView({ kind: 'dirs' }) }),
    createElement(StatusView, null),
  )
}
