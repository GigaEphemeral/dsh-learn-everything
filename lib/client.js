window.__ModuleLoader__.load({ id: "dsh-learn-everything", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var import_react3 = require("react");

// src/client/ObsidianPanel.js
var import_react = require("react");

// src/sidebar/route-errors.js
var NOT_CONFIGURED_CODE = "obsidian-not-configured";
var UNAUTHORIZED_CODE = "unauthorized";
var FORBIDDEN_CODE = "forbidden";
var NOT_CONFIGURED_UI_TEXT = "Obsidian \u672A\u914D\u7F6E\uFF1A\u8BF7\u5728 DSH \u63D2\u4EF6\u8BBE\u7F6E\uFF08dsh-learn-everything\uFF09\u586B\u5199 API Key\uFF0C\u6216\u8BBE\u7F6E OBSIDIAN_API_KEY \u540E\u91CD\u8BD5\u3002";
var FENCE_UI_TEXT = "\u8BF7\u6C42\u88AB DSH \u8FDE\u63A5\u7B56\u7565\u62D2\u7EDD\uFF1A\u8BF7\u7528 dsh \u542F\u52A8\u65F6\u6253\u5370\u7684\u5E26 token URL \u91CD\u65B0\u6253\u5F00\u9875\u9762\u3002";
function routeErrorText(error) {
  const code = error?.code;
  if (code === NOT_CONFIGURED_CODE) return NOT_CONFIGURED_UI_TEXT;
  if (code === UNAUTHORIZED_CODE || code === FORBIDDEN_CODE) return FENCE_UI_TEXT;
  return error?.message ?? "\u8BF7\u6C42\u5931\u8D25";
}

// src/markdown/render.js
var ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
var PLACEHOLDER_RE = /\uE000(\d+)\uE001/g;
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ESCAPES[character]);
}
function safeUrl(encoded) {
  const url = encoded.trim();
  if (/^(https?:|mailto:|obsidian:|#|\/|\.\/|\.\.\/)/i.test(url)) return url;
  return "#";
}
function wikilinkPath(target) {
  const note = target.split("#")[0].split("^")[0].trim();
  if (!note || /^[a-z][a-z0-9+.-]*:/i.test(note)) return null;
  if (/^wiki\//.test(note) || /^(Sources|Learning)\//.test(note)) return note;
  if (/^(concepts|entities|sources)\//.test(note)) return "wiki/" + note;
  if (!note.includes("/")) return "wiki/" + note;
  return note;
}
function wikilink(target, label) {
  const path = wikilinkPath(target);
  if (path === null) return label ?? target;
  return `<a href="#" class="dsh-obsidian-wikilink" data-wikilink="${path}.md">${label ?? target}</a>`;
}
function tokenizeInline(escaped) {
  const tokens = [];
  const keep = (html) => `\uE000${tokens.push(html) - 1}\uE001`;
  let text = escaped;
  text = text.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`));
  text = text.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_, alt, url) => keep(`<img alt="${alt}" src="${safeUrl(url)}" loading="lazy">`)
  );
  text = text.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, label, url) => keep(`<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`)
  );
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => keep(wikilink(target, label)));
  return { text, tokens };
}
function emphasize(text) {
  let result = text;
  result = result.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  result = result.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  result = result.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  result = result.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  return result;
}
function renderInline(value) {
  const { text, tokens } = tokenizeInline(escapeHtml(value));
  return emphasize(text).replace(PLACEHOLDER_RE, (_, index) => tokens[Number(index)] ?? "");
}
function splitCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}
function isTableStart(lines, index) {
  if (index + 1 >= lines.length || !lines[index].includes("|")) return false;
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
}
function renderTable(lines, start) {
  const header = splitCells(lines[start]);
  const rows = [];
  let index = start + 2;
  while (index < lines.length && lines[index].includes("|") && !/^\s*$/.test(lines[index])) {
    rows.push(splitCells(lines[index]));
    index += 1;
  }
  const head = header.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("");
  return { html: `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`, next: index };
}
function renderList(lines, start) {
  const ordered = /^\s*\d/.test(lines[start]);
  const items = [];
  let index = start;
  while (index < lines.length) {
    const match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[index]);
    if (!match) {
      if (items.length > 0 && /^\s{2,}\S/.test(lines[index])) {
        items[items.length - 1] += " " + lines[index].trim();
        index += 1;
        continue;
      }
      break;
    }
    items.push(match[3]);
    index += 1;
  }
  const tag = ordered ? "ol" : "ul";
  const html = `<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`;
  return { html, next: index };
}
function renderFence(lines, start) {
  const opening = /^\s*```(\w*)\s*$/.exec(lines[start]);
  const language = opening?.[1] ?? "";
  const code = [];
  let index = start + 1;
  while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
    code.push(lines[index]);
    index += 1;
  }
  if (index < lines.length) index += 1;
  const className = language ? ` class="language-${escapeHtml(language)}"` : "";
  return { html: `<pre><code${className}>${escapeHtml(code.join("\n"))}</code></pre>`, next: index };
}
function stripFrontmatter(source) {
  const normalized = String(source ?? "").replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) return normalized;
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) return normalized;
  const after = normalized.slice(end + 4);
  return after.startsWith("\n") ? after.slice(1) : after;
}
function renderMarkdown(source) {
  const lines = stripFrontmatter(source).split("\n");
  const blocks = [];
  const paragraph = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
    paragraph.length = 0;
  };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*$/.test(line)) {
      flush();
      index += 1;
      continue;
    }
    if (/^\s*```/.test(line)) {
      flush();
      const fence = renderFence(lines, index);
      blocks.push(fence.html);
      index = fence.next;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      const text = renderInline(heading[2].replace(/\s+#+\s*$/, ""));
      blocks.push(`<h${level}>${text}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push("<hr>");
      index += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const quoted = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${renderMarkdown(quoted.join("\n"))}</blockquote>`);
      continue;
    }
    if (isTableStart(lines, index)) {
      flush();
      const table = renderTable(lines, index);
      blocks.push(table.html);
      index = table.next;
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      const list = renderList(lines, index);
      blocks.push(list.html);
      index = list.next;
      continue;
    }
    paragraph.push(line.trim());
    index += 1;
  }
  flush();
  return blocks.join("\n");
}

// src/client/ObsidianPanel.js
var DIRS = ["wiki/concepts", "wiki/entities", "wiki/sources", "Sources"];
var vaultName = "learnEverything";
function openInObsidian(path) {
  return "obsidian://open?vault=" + encodeURIComponent(vaultName) + "&file=" + encodeURIComponent(path);
}
var MD_STYLE = `
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
`;
function apiUrl(path, params) {
  const base = window.location.origin;
  const qs = new URLSearchParams(params).toString();
  return base + path + (qs ? "?" + qs : "");
}
async function getJson(url) {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    let body = null;
    try {
      body = await res.json();
    } catch {
    }
    if (!res.ok || body?.ok === false) {
      return { ok: false, error: body?.error ?? { code: "http-" + res.status, message: "HTTP " + res.status } };
    }
    return body ?? { ok: false, error: { code: "empty", message: "empty response" } };
  } catch (err) {
    return { ok: false, error: { code: "network", message: String(err) } };
  }
}
function errorText(j) {
  return routeErrorText(j?.error);
}
function ErrorBanner(props) {
  if (!props.text) return null;
  return (0, import_react.createElement)("div", {
    style: {
      margin: "8px",
      padding: "6px 8px",
      borderRadius: 4,
      fontSize: 12,
      background: "#3a2323",
      color: "#ffb4b4",
      border: "1px solid #5a2a2a"
    }
  }, props.text);
}
function DirList(props) {
  const onOpen = props.onOpen;
  const [lists, setLists] = (0, import_react.useState)({});
  const [error, setError] = (0, import_react.useState)("");
  (0, import_react.useEffect)(() => {
    let ignore = false;
    Promise.all(DIRS.map((dir) => getJson(apiUrl("/obsidian/api/list", { dir })).then((result) => ({ dir, result })))).then((answers) => {
      if (ignore) return;
      const next = {};
      const errors = [];
      for (const { dir, result } of answers) {
        if (result.ok && Array.isArray(result.value?.files)) next[dir] = result.value.files;
        else errors.push(errorText(result));
      }
      setLists(next);
      setError(errors[0] ?? "");
    });
    return () => {
      ignore = true;
    };
  }, []);
  return (0, import_react.createElement)(
    "div",
    { style: { padding: 8, fontSize: 13 } },
    (0, import_react.createElement)(ErrorBanner, { text: error }),
    ...DIRS.map(
      (dir) => (0, import_react.createElement)(
        "div",
        { key: dir, style: { marginBottom: 10 } },
        (0, import_react.createElement)("b", null, dir),
        (lists[dir] ?? []).map(
          (f) => (0, import_react.createElement)(
            "div",
            { key: dir + "/" + f, style: { paddingLeft: 10, cursor: "pointer", color: "#6cb6ff" } },
            (0, import_react.createElement)("a", { href: "#", onClick: (e) => {
              e.preventDefault();
              onOpen(dir + "/" + f);
            } }, f)
          )
        )
      )
    )
  );
}
function SearchView(props) {
  const onOpen = props.onOpen;
  const [q, setQ] = (0, import_react.useState)("");
  const [results, setResults] = (0, import_react.useState)([]);
  const [error, setError] = (0, import_react.useState)("");
  const run = () => {
    const query = q.trim();
    if (!query) return;
    setError("");
    getJson(apiUrl("/obsidian/api/search", { q: query })).then((j) => {
      if (j.ok) setResults(j.value?.results ?? []);
      else setError(errorText(j));
    });
  };
  return (0, import_react.createElement)(
    "div",
    { style: { padding: 8, fontSize: 13 } },
    (0, import_react.createElement)(ErrorBanner, { text: error }),
    (0, import_react.createElement)("input", { value: q, placeholder: "\u641C\u7D22\u77E5\u8BC6\u5E93\u2026", onChange: (e) => setQ(e.target.value), onKeyDown: (e) => {
      if (e.key === "Enter") run();
    }, style: { width: "100%", boxSizing: "border-box", padding: 4 } }),
    (0, import_react.createElement)("button", { onClick: run, style: { marginTop: 4 } }, "\u641C\u7D22"),
    results.map(
      (r) => (0, import_react.createElement)(
        "div",
        { key: r.path, style: { padding: 4, cursor: "pointer", color: "#6cb6ff" } },
        (0, import_react.createElement)("a", { href: "#", onClick: (e) => {
          e.preventDefault();
          onOpen(r.path);
        } }, r.path + " \u2014 " + String(r.excerpt ?? "").slice(0, 60))
      )
    )
  );
}
function NoteView(props) {
  const path = props.path;
  const onBack = props.onBack;
  const [content, setContent] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)("");
  (0, import_react.useEffect)(() => {
    let ignore = false;
    setContent(null);
    setError("");
    getJson(apiUrl("/obsidian/api/read", { path })).then((j) => {
      if (ignore) return;
      if (j.ok) setContent(j.value?.content ?? "");
      else setError(errorText(j));
    });
    return () => {
      ignore = true;
    };
  }, [path]);
  const onPreviewClick = (event) => {
    const link = event.target?.closest?.("[data-wikilink]");
    if (!link) return;
    event.preventDefault();
    const next = link.getAttribute("data-wikilink");
    if (next) props.onOpen(next);
  };
  return (0, import_react.createElement)(
    "div",
    { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } },
    (0, import_react.createElement)(
      "div",
      { style: { padding: "8px", borderBottom: "1px solid #2c2c2c", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 } },
      (0, import_react.createElement)("button", { onClick: onBack, style: { flexShrink: 0 } }, "\u2190 \u8FD4\u56DE"),
      (0, import_react.createElement)("span", { title: path, style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: "#aaa" } }, path),
      (0, import_react.createElement)("a", { href: openInObsidian(path), style: { flexShrink: 0, color: "#6cb6ff", fontSize: 12 } }, "\u5728 Obsidian \u6253\u5F00")
    ),
    (0, import_react.createElement)(
      "div",
      { style: { flex: 1, minHeight: 0, overflowY: "auto", padding: "0 10px 14px" } },
      (0, import_react.createElement)("style", null, MD_STYLE),
      content === null ? (0, import_react.createElement)("div", { style: { padding: "10px 0", color: "#888", fontSize: 12 } }, error ? null : "\u52A0\u8F7D\u4E2D\u2026") : (0, import_react.createElement)("div", {
        className: "dsh-obsidian-md",
        onClick: onPreviewClick,
        dangerouslySetInnerHTML: { __html: renderMarkdown(content) }
      }),
      (0, import_react.createElement)(ErrorBanner, { text: error })
    )
  );
}
function GraphView() {
  return (0, import_react.createElement)(
    "div",
    { style: { flex: 1, minHeight: 0, padding: 8, boxSizing: "border-box" } },
    (0, import_react.createElement)("iframe", {
      src: apiUrl("/obsidian/graph-page"),
      title: "\u77E5\u8BC6\u56FE\u8C31",
      style: { width: "100%", height: "100%", minHeight: 420, border: 0, borderRadius: 6, background: "#1e1e1e" }
    })
  );
}
function StatusView() {
  const [status, setStatus] = (0, import_react.useState)("\u2014");
  (0, import_react.useEffect)(() => {
    let ignore = false;
    const load = () => {
      getJson(apiUrl("/obsidian/compile-status")).then((j) => {
        if (ignore) return;
        if (j.ok && j.value?.last) {
          const last = j.value.last;
          setStatus(last.stage + (last.source ? " \xB7 " + last.source : "") + " \xB7 " + (last.at ?? ""));
        } else if (!j.ok) {
          setStatus("\u4E0D\u53EF\u7528");
        }
      });
    };
    load();
    const timer = setInterval(load, 5e3);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, []);
  return (0, import_react.createElement)("div", { style: { padding: "6px 8px", borderTop: "1px solid #2c2c2c", fontSize: 11, color: "#888", flexShrink: 0 } }, "\u7F16\u8BD1: " + status);
}
function ObsidianPanel(props) {
  const [view, setView] = (0, import_react.useState)({ kind: "dirs" });
  (0, import_react.useEffect)(() => {
    getJson(apiUrl("/obsidian/api/config")).then((j) => {
      if (j.ok && j.value?.vaultName) vaultName = j.value.vaultName;
    });
  }, []);
  const nav = (label, kind) => (0, import_react.createElement)("button", { onClick: () => setView(kind), style: { marginRight: 6 } }, label);
  const openNote = (path) => setView({ kind: "note", path });
  const bodyStyle = view.kind === "note" || view.kind === "graph" ? { flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" } : { flex: 1, minHeight: 0, overflowY: "auto" };
  return (0, import_react.createElement)(
    "div",
    { style: { height: "100%", minHeight: 0, display: "flex", flexDirection: "column", fontFamily: "-apple-system, Segoe UI, sans-serif", color: "#ddd" } },
    (0, import_react.createElement)(
      "div",
      { style: { padding: 8, borderBottom: "1px solid #2c2c2c", flexShrink: 0 } },
      nav("\u76EE\u5F55", { kind: "dirs" }),
      nav("\u641C\u7D22", { kind: "search" }),
      nav("\u56FE\u8C31", { kind: "graph" })
    ),
    (0, import_react.createElement)(
      "div",
      { style: bodyStyle },
      view.kind === "dirs" && (0, import_react.createElement)(DirList, { onOpen: openNote }),
      view.kind === "search" && (0, import_react.createElement)(SearchView, { onOpen: openNote }),
      view.kind === "graph" && (0, import_react.createElement)(GraphView),
      view.kind === "note" && (0, import_react.createElement)(NoteView, { path: view.path, onBack: () => setView({ kind: "dirs" }), onOpen: openNote })
    ),
    (0, import_react.createElement)(StatusView)
  );
}

// src/client/ObsidianConfigCard.js
var import_react2 = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/config-locales.js
var zh = {
  title: "Obsidian \u8FDE\u63A5",
  description: "\u914D\u7F6E Obsidian Local REST API \u7684\u5730\u5740\u4E0E\u5BC6\u94A5\uFF0C\u9762\u677F\u901A\u8FC7\u540E\u7AEF\u8DEF\u7531\u8BBF\u95EE\u77E5\u8BC6\u5E93\u3002",
  apiKey: "API Key",
  apiKeyHint: "Obsidian Local REST API \u7684\u5BC6\u94A5\uFF1B\u7559\u7A7A\u8868\u793A\u4E0D\u4FEE\u6539\u5F53\u524D\u503C\uFF0C\u5E76\u56DE\u9000\u5230 OBSIDIAN_API_KEY\u3002",
  apiKeySet: "\u5DF2\u914D\u7F6E",
  apiKeyUnset: "\u672A\u914D\u7F6E",
  baseUrl: "API \u5730\u5740",
  baseUrlHint: "\u901A\u5E38\u662F https://127.0.0.1:27124\uFF1B\u7559\u7A7A\u56DE\u9000\u5230 OBSIDIAN_BASE_URL \u6216\u9ED8\u8BA4\u5730\u5740\u3002",
  overridden: "\u5DF2\u8986\u76D6",
  reset: "\u6062\u590D\u9ED8\u8BA4",
  invalid: "\u503C\u4E0D\u5408\u6CD5",
  save: "\u4FDD\u5B58",
  saving: "\u4FDD\u5B58\u4E2D\u2026",
  saveFailed: "\u4FDD\u5B58\u672A\u751F\u6548\uFF0C\u8BF7\u68C0\u67E5\u540E\u91CD\u8BD5",
  unavailable: "\u6B64\u8BBE\u7F6E\u5F53\u524D\u4E0D\u53EF\u7528",
  readOnly: "\u5F53\u524D\u8BBE\u7F6E\u6587\u6863\u4E3A\u53EA\u8BFB"
};
var en = {
  title: "Obsidian connection",
  description: "Configure the Obsidian Local REST API address and key; the panel reaches the vault through backend routes.",
  apiKey: "API Key",
  apiKeyHint: "Key of the Obsidian Local REST API. Leave blank to keep the current value and fall back to OBSIDIAN_API_KEY.",
  apiKeySet: "Configured",
  apiKeyUnset: "Not configured",
  baseUrl: "API address",
  baseUrlHint: "Usually https://127.0.0.1:27124; leave blank to fall back to OBSIDIAN_BASE_URL or the default.",
  overridden: "Overridden",
  reset: "Reset",
  invalid: "Invalid value",
  save: "Save",
  saving: "Saving\u2026",
  saveFailed: "The save did not land; check the value and retry",
  unavailable: "This setting is currently unavailable",
  readOnly: "The settings document is read-only"
};
function formLabels(t) {
  return {
    unavailable: t("unavailable"),
    readOnly: t("readOnly"),
    saveFailed: t("saveFailed"),
    save: t("save"),
    saving: t("saving")
  };
}

// src/client/ObsidianConfigCard.js
function ObsidianConfigCard(props) {
  const { t } = props;
  const state = props.useObsidianConfigForm((value) => value);
  const disabled = !state.writable || state.saving;
  return (0, import_react2.createElement)(
    import_dsh_client_ui_primitives.SettingsForm,
    { labels: formLabels(t), state, onSave: props.save, onDiscard: props.discard },
    (0, import_react2.createElement)(import_dsh_client_ui_primitives.SettingsSecretField, {
      id: "plugin-config-obsidian-api-key",
      label: t("apiKey"),
      hint: t("apiKeyHint"),
      text: state.apiKey.text,
      configured: state.apiKeyConfigured,
      stateLabel: state.apiKeyConfigured ? t("apiKeySet") : t("apiKeyUnset"),
      disabled,
      onEdit: (text) => {
        props.edit("apiKey", text);
      }
    }),
    (0, import_react2.createElement)(import_dsh_client_ui_primitives.SettingsValueField, {
      id: "plugin-config-obsidian-base-url",
      label: t("baseUrl"),
      hint: t("baseUrlHint"),
      overriddenLabel: t("overridden"),
      resetLabel: t("reset"),
      invalidLabel: t("invalid"),
      disabled,
      ...state.baseUrl,
      onEdit: (text) => {
        props.edit("baseUrl", text);
      },
      onReset: () => {
        props.resetField("baseUrl");
      }
    })
  );
}

// src/client/obsidian-config-form.js
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/config-page.js
var BUNDLE_NAME = "dsh-learn-everything";
var SETTINGS_NAMESPACE = "dsh-learn-everything";
var LOCALE_NS = "settings.dshLearnEverything";
function registerBundleConfigPage(ctx, page) {
  return ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
    name: "plugins.bundle.config",
    key: BUNDLE_NAME,
    locale: page.locale,
    inject: page.inject
  }, page.component));
}

// src/client/obsidian-config-form.js
var apiKeyField = {
  field: "apiKey",
  format: () => "",
  parse: (text) => {
    const value = text.trim();
    return value === "" ? { kind: "clear" } : { kind: "set", value };
  }
};
function secretConfigured(ctx) {
  try {
    const view = ctx.configForms.describe().getSnapshot().view;
    const namespace = view?.namespaces?.find((row) => row.ns === SETTINGS_NAMESPACE);
    return (namespace?.secrets ?? []).some(
      (secret) => secret.path.length === 1 && secret.path[0] === "apiKey" && secret.set
    );
  } catch {
    return false;
  }
}
function createObsidianConfigForm(ctx) {
  const scope = ctx.configForms.get(SETTINGS_NAMESPACE);
  const form = new import_dsh_client_ui_primitives2.SettingsFormModel(scope, [(0, import_dsh_client_ui_primitives2.settingsTextField)("baseUrl"), apiKeyField]);
  const state = form.bind(() => ({
    ...form.shell(),
    apiKey: form.field("apiKey"),
    baseUrl: form.field("baseUrl"),
    apiKeyConfigured: secretConfigured(ctx)
  }));
  return {
    hooks: { obsidianConfigForm: state },
    ...form.actions(),
    dispose: () => {
      form.dispose();
    }
  };
}

// src/client/index.js
var name = "dsh-learn-everything";
var inject = ["slots", "sidebarRightTabs", "configForms", "locale"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), "dsh-learn-everything: config dictionaries");
  ctx.effect(() => {
    const form = createObsidianConfigForm(ctx);
    const off = registerBundleConfigPage(ctx, {
      component: ObsidianConfigCard,
      locale: LOCALE_NS,
      inject: () => ({ ...form })
    });
    return () => {
      if (typeof off === "function") off();
      form.dispose();
    };
  }, "dsh-learn-everything: Plugins-page config card");
  ctx.inject(["sidebarRightTabs"], (injected) => {
    const tabs = injected.get("sidebarRightTabs");
    if (!tabs || typeof tabs.register !== "function") return;
    ctx.effect(() => {
      const disposeType = tabs.register({
        id: "obsidian",
        kind: "dsh-learn-everything:obsidian",
        keepMounted: true,
        priority: "extension",
        title: () => "Obsidian",
        guide: [{
          id: "dsh-learn-everything:obsidian",
          order: 150,
          title: () => "Obsidian",
          description: () => "Obsidian \u77E5\u8BC6\u5E93\u8BBF\u95EE\u9762\u677F\uFF08S4\uFF09"
        }]
      });
      const offBody = ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
        name: "sidebar.right.pane.tab",
        key: "obsidian",
        inject: (sessionId) => ({ sessionId })
      }, ObsidianPanel));
      const offTitle = ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
        name: "sidebar.right.pane.tab.title",
        key: "obsidian",
        inject: (sessionId) => ({ sessionId })
      }, ObsidianTitle));
      return () => {
        disposeType();
        if (typeof offBody === "function") offBody();
        if (typeof offTitle === "function") offTitle();
      };
    });
  });
}
function ObsidianTitle(props) {
  return (0, import_react3.createElement)("span", null, "Obsidian");
}
return module.exports; } });
