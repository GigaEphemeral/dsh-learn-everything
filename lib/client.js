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
        offBody();
        offTitle();
      };
    });
  });
}
function ObsidianTitle(props) {
  return (0, import_react3.createElement)("span", null, "Obsidian");
}
return module.exports; } });
