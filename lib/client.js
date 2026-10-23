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
var import_react2 = require("react");

// src/client/ObsidianPanel.js
var import_react = require("react");

// src/sidebar/route-errors.js
var NOT_CONFIGURED_CODE = "obsidian-not-configured";
var NOT_CONFIGURED_UI_TEXT = "Obsidian \u672A\u914D\u7F6E\uFF1A\u8BF7\u5728 DSH \u63D2\u4EF6\u8BBE\u7F6E\uFF08dsh-learn-everything\uFF09\u586B\u5199 API Key\uFF0C\u6216\u8BBE\u7F6E OBSIDIAN_API_KEY \u540E\u91CD\u8BD5\u3002";
var FENCE_UI_TEXT = "\u8BF7\u6C42\u88AB DSH \u8FDE\u63A5\u7B56\u7565\u62D2\u7EDD\uFF1A\u8BF7\u7528 dsh \u542F\u52A8\u65F6\u6253\u5370\u7684\u5E26 token URL \u91CD\u65B0\u6253\u5F00\u9875\u9762\u3002";
function routeErrorText(error) {
  const code = error?.code;
  if (code === NOT_CONFIGURED_CODE) return NOT_CONFIGURED_UI_TEXT;
  if (code === "unauthorized" || code === "forbidden") return FENCE_UI_TEXT;
  return error?.message ?? "\u8BF7\u6C42\u5931\u8D25";
}

// src/client/ObsidianPanel.js
var DIRS = ["wiki/concepts", "wiki/entities", "wiki/sources", "Sources"];
function apiUrl(path, params) {
  const base = (document.baseURI ?? window.location.href).replace(/\/$/, "");
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
    for (const dir of DIRS) {
      getJson(apiUrl("/obsidian/api/list", { dir })).then((j) => {
        if (j.ok && Array.isArray(j.value?.files)) {
          setLists((prev) => Object.assign({}, prev, { [dir]: j.value.files }));
        } else if (!j.ok) {
          setError(errorText(j));
        }
      });
    }
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
    if (!q.trim()) return;
    setError("");
    getJson(apiUrl("/obsidian/api/search", { q })).then((j) => {
      if (j.ok) setResults(j.value?.results ?? []);
      else setError(errorText(j));
    });
  };
  return (0, import_react.createElement)(
    "div",
    { style: { padding: 8, fontSize: 13 } },
    (0, import_react.createElement)(ErrorBanner, { text: error }),
    (0, import_react.createElement)("input", { value: q, placeholder: "\u641C\u7D22\u77E5\u8BC6\u5E93\u2026", onInput: (e) => setQ(e.target.value), onKeyDown: (e) => {
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
  const [content, setContent] = (0, import_react.useState)("");
  (0, import_react.useEffect)(() => {
    getJson(apiUrl("/obsidian/api/read", { path })).then((j) => {
      if (j.ok) setContent(j.value?.content ?? "(empty)");
      else setContent(errorText(j));
    });
  }, [path]);
  return (0, import_react.createElement)(
    "div",
    { style: { padding: 8, fontSize: 12 } },
    (0, import_react.createElement)("button", { onClick: onBack }, "\u2190 \u8FD4\u56DE"),
    (0, import_react.createElement)(
      "div",
      { style: { marginTop: 6 } },
      path,
      (0, import_react.createElement)("a", { href: "obsidian://open?vault=learnEverything&file=" + encodeURIComponent(path), style: { marginLeft: 8 } }, "\u5728 Obsidian \u6253\u5F00")
    ),
    (0, import_react.createElement)("pre", { style: { whiteSpace: "pre-wrap", marginTop: 6 } }, String(content).slice(0, 3e3))
  );
}
function GraphView() {
  const [data, setData] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)("");
  (0, import_react.useEffect)(() => {
    getJson(apiUrl("/obsidian/graph")).then((j) => {
      if (j.ok) setData(encodeURIComponent(JSON.stringify(j.value)));
      else setError(errorText(j));
    });
  }, []);
  return (0, import_react.createElement)(
    "div",
    { style: { padding: 8 } },
    (0, import_react.createElement)(ErrorBanner, { text: error }),
    data === null ? (0, import_react.createElement)("span", null, error ? "\u56FE\u8C31\u4E0D\u53EF\u7528" : "\u56FE\u8C31\u52A0\u8F7D\u4E2D\u2026") : (0, import_react.createElement)("iframe", { src: apiUrl("/obsidian/graph-page", { data }), style: { width: "100%", height: 520, border: 0, borderRadius: 6 } })
  );
}
function StatusView() {
  const [status, setStatus] = (0, import_react.useState)("\u2014");
  (0, import_react.useEffect)(() => {
    getJson(apiUrl("/obsidian/compile-status")).then((j) => {
      if (j.ok && j.value?.last) {
        const last = j.value.last;
        setStatus(last.stage + (last.source ? " \xB7 " + last.source : "") + " \xB7 " + (last.at ?? ""));
      }
    });
  }, []);
  return (0, import_react.createElement)("div", { style: { padding: 8, fontSize: 12, color: "#888" } }, "\u7F16\u8BD1: " + status);
}
function ObsidianPanel(props) {
  const [view, setView] = (0, import_react.useState)({ kind: "dirs" });
  const nav = (label, kind) => (0, import_react.createElement)("button", { onClick: () => setView(kind), style: { marginRight: 6 } }, label);
  return (0, import_react.createElement)(
    "div",
    { style: { fontFamily: "-apple-system, Segoe UI, sans-serif", color: "#ddd" } },
    (0, import_react.createElement)(
      "div",
      { style: { padding: 8, borderBottom: "1px solid #333" } },
      nav("\u76EE\u5F55", { kind: "dirs" }),
      nav("\u641C\u7D22", { kind: "search" }),
      nav("\u56FE\u8C31", { kind: "graph" })
    ),
    view.kind === "dirs" && (0, import_react.createElement)(DirList, { onOpen: (path) => setView({ kind: "note", path }) }),
    view.kind === "search" && (0, import_react.createElement)(SearchView, { onOpen: (path) => setView({ kind: "note", path }) }),
    view.kind === "graph" && (0, import_react.createElement)(GraphView, null),
    view.kind === "note" && (0, import_react.createElement)(NoteView, { path: view.path, onBack: () => setView({ kind: "dirs" }) }),
    (0, import_react.createElement)(StatusView, null)
  );
}

// src/client/index.js
var name = "dsh-learn-everything";
var inject = ["slots", "sidebarRightTabs"];
function apply(ctx) {
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
        offBody();
        offTitle();
      };
    });
  });
}
function ObsidianTitle(props) {
  return (0, import_react2.createElement)("span", null, "Obsidian");
}
return module.exports; } });
