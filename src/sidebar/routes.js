// R2 sidebar data routes (S4): serve Obsidian knowledge data to the panel
// client over same-origin fenced routes. The Obsidian API key stays in the
// backend; the browser never sees it. Route contract mirrors the host
// SidebarWebRoute ({ kind, path, handler }) and fences every request with the
// host connection policy.
//
// Routes are registered even when no API key is configured yet: the data
// routes answer 503 obsidian-not-configured so the panel can explain what to
// set, instead of a 404 that looks like "the plugin did not load". The key and
// base URL are resolved per request, so a volatile settings edit applies
// without restarting the host.

import { ObsidianClient, ObsidianAdapter, ObsidianError } from "../obsidian/obsidian-adapter.js";
import { SearchRetriever } from "../search/retriever.js";
import { classifyIntent, INTENT } from "../search/intent.js";
import { assessSufficiency } from "../search/evidence.js";
import { buildGraph } from "../wiki/graph.js";
import { readCompileStatus } from "../obsidian/compile-status.js";
import { WIKI_DIRS } from "../wiki/karpathy-driver.js";
import { FORBIDDEN_CODE, NOT_CONFIGURED_CODE, NOT_CONFIGURED_MESSAGE, UNAUTHORIZED_CODE } from "./route-errors.js";

export const DEFAULT_BASE_URL = "https://127.0.0.1:27124";
const GRAPH_READ_CONCURRENCY = 8;

function writeJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function writeError(res, status, code, message) {
  writeJson(res, status, { ok: false, error: { code, message } });
}

function notConfigured(res) {
  writeError(res, 503, NOT_CONFIGURED_CODE, NOT_CONFIGURED_MESSAGE);
}

function queryParams(url) {
  try {
    const u = new URL(url ?? "", "http://internal");
    return u.searchParams;
  } catch {
    return new URLSearchParams();
  }
}

// One shared Obsidian data layer: client + adapter + retriever.
export function createObsidianData({ apiKey, baseUrl = DEFAULT_BASE_URL, compileStatusFile = null }) {
  const client = new ObsidianClient({ baseUrl, apiKey });
  const adapter = new ObsidianAdapter(client);
  const retriever = new SearchRetriever({ adapter });
  return { client, adapter, retriever, compileStatusFile };
}

// A construction failure (for example a malformed base URL) is not the same
// as "no API key": keep it visible as an explicit configuration error.
const DATA_ERROR = Symbol("obsidian-data-error");

function dataAccessor(source) {
  if (typeof source === "function") {
    return () => {
      try {
        return source();
      } catch (err) {
        console.warn("[dsh-learn-everything] obsidian data layer failed:", err?.message || err);
        return { [DATA_ERROR]: err };
      }
    };
  }
  return () => source;
}

// Read pages for the graph with bounded concurrency; one unreadable entry must
// not blank the whole graph, and list() 404s already degrade to an empty dir.
async function graphPages(adapter, dirs) {
  const paths = [];
  for (const dir of dirs) {
    let files = [];
    try {
      const listing = await adapter.list(dir);
      files = Array.isArray(listing?.files) ? listing.files : [];
    } catch (err) {
      if (err instanceof ObsidianError && err.status === 404) continue;
      throw err;
    }
    for (const file of files) paths.push(dir + "/" + file);
  }
  const pages = [];
  for (let start = 0; start < paths.length; start += GRAPH_READ_CONCURRENCY) {
    const batch = paths.slice(start, start + GRAPH_READ_CONCURRENCY);
    const contents = await Promise.all(batch.map(async (path) => {
      try {
        return { path, content: await adapter.read(path) };
      } catch (err) {
        if (err instanceof ObsidianError) return null;
        throw err;
      }
    }));
    for (const page of contents) if (page && typeof page.content === "string") pages.push(page);
  }
  return pages;
}

// Route handlers keyed by name; each (req, res) writes its JSON envelope.
// `source` is either a data object (tests, static wiring) or a getter that
// returns the current data layer or null when unconfigured.
export function makeRouteHandlers(source, { getConfig } = {}) {
  const current = dataAccessor(source);
  const requireData = (res) => {
    const data = current();
    if (data === DATA_ERROR || data?.[DATA_ERROR] !== undefined) {
      writeError(res, 500, "obsidian-config", "Obsidian configuration is invalid: check the API address.");
      return null;
    }
    if (data === null || data === undefined) {
      notConfigured(res);
      return null;
    }
    return data;
  };
  const handlers = {};

  handlers.list = async (req, res) => {
    const data = requireData(res);
    if (!data) return;
    const dir = queryParams(req.url).get("dir") ?? "";
    try {
      const { files } = await data.adapter.list(dir);
      writeJson(res, 200, { ok: true, value: { dir, files: files ?? [] } });
    } catch (err) {
      if (err instanceof ObsidianError && err.status === 404) writeJson(res, 200, { ok: true, value: { dir, files: [] } });
      else writeError(res, 500, "obsidian-list", err.message);
    }
  };

  handlers.search = async (req, res) => {
    const data = requireData(res);
    if (!data) return;
    const q = queryParams(req.url).get("q") ?? "";
    if (!q.trim()) return writeError(res, 400, "bad-request", "query is empty");
    try {
      const intent = classifyIntent(q);
      const results = await data.retriever.wikiFirst(q);
      const sufficiency = assessSufficiency(q, results, { exactFact: intent === INTENT.source });
      writeJson(res, 200, { ok: true, value: { intent, sufficiency, results } });
    } catch (err) {
      writeError(res, 500, "obsidian-search", err.message);
    }
  };

  handlers.read = async (req, res) => {
    const data = requireData(res);
    if (!data) return;
    const path = queryParams(req.url).get("path") ?? "";
    if (!path) return writeError(res, 400, "bad-request", "path is empty");
    try {
      const content = await data.adapter.read(path);
      if (content === null) writeError(res, 404, "not-found", "note " + path + " not found");
      else writeJson(res, 200, { ok: true, value: { path, content } });
    } catch (err) {
      // ObsidianAdapter.read throws on 404; a missing note is a 404, not a 500.
      if (err instanceof ObsidianError && err.status === 404) {
        writeError(res, 404, "not-found", "note " + path + " not found");
      } else {
        writeError(res, 500, "obsidian-read", err.message);
      }
    }
  };

  handlers.graph = async (req, res) => {
    const data = requireData(res);
    if (!data) return;
    try {
      const pages = await graphPages(data.adapter, WIKI_DIRS);
      writeJson(res, 200, { ok: true, value: buildGraph(pages) });
    } catch (err) {
      writeError(res, 500, "obsidian-graph", err.message);
    }
  };

  // Serve the static graph page (panel/graph.html) so the panel can embed it
  // in an iframe. The page fetches /obsidian/graph itself, so the graph JSON
  // never rides a request URL (which used to exceed the request-line limit).
  handlers.graphPage = async (req, res) => {
    try {
      const { readFile } = await import("node:fs/promises");
      const html = await readFile(new URL("../../panel/graph.html", import.meta.url), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (err) {
      writeError(res, 500, "obsidian-graph-page", err.message);
    }
  };

  // Self-hosted open-source graph library used by the page's relative script
  // URL (./vis-network.min.js resolves under /obsidian/).
  handlers.graphLib = async (req, res) => {
    try {
      const { readFile } = await import("node:fs/promises");
      const bundle = await readFile(new URL("../../panel/vis-network.min.js", import.meta.url));
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "public, max-age=86400",
      });
      res.end(bundle);
    } catch (err) {
      writeError(res, 500, "obsidian-graph-lib", err.message);
    }
  };

  handlers.compileStatus = async (req, res) => {
    try {
      // Never take a filesystem path from the request: only the configured
      // status file may be read, so this route cannot exfiltrate arbitrary
      // JSON (settings, credentials) through the panel's trust boundary.
      const configured = getConfig?.()?.compileStatusFile ?? current()?.compileStatusFile;
      const filePath = typeof configured === "string" && configured.trim() ? configured : null;
      const status = filePath ? await readCompileStatus(filePath) : { stages: [], last: null };
      writeJson(res, 200, { ok: true, value: status });
    } catch (err) {
      writeError(res, 500, "obsidian-compile-status", err.message);
    }
  };

  return handlers;
}

// Minimal host check used when the host connection service is absent: only
// local-loopback Hosts pass (defence against DNS rebinding of a route that
// serves vault data).
function localHostFence(req) {
  const host = String(req?.headers?.host ?? "").trim();
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname.replace(/\.$/, "").toLowerCase();
    return hostname === "localhost" || hostname === "::1" || hostname === "[::1]"
      || /^127\.\d+\.\d+\.\d+$/.test(hostname);
  } catch {
    return false;
  }
}

// Read a service without the Cordis property-getter semantics: an undeclared
// property read can throw, which previously escaped the route handler and made
// the web server answer an empty 400.
function serviceOf(ctx, name) {
  if (typeof ctx?.get === "function") return ctx.get(name);
  return ctx?.[name];
}

// Register every route with host fencing. ctx must be the injected context
// with webServer available. Options are either a static
// { apiKey, baseUrl, compileStatusFile } or { getConfig() } returning the
// current config, so volatile settings edits are visible per request.
// Returns the route registration disposers.
export function registerObsidianRoutes(ctx, options = {}) {
  if (typeof ctx?.webServer?.register !== "function") {
    return [];
  }
  const getConfig =
    typeof options === "function"
      ? options
      : typeof options.getConfig === "function"
        ? options.getConfig
        : () => options;

  const createData = typeof options.createData === "function" ? options.createData : createObsidianData;
  let cachedData = null;
  let cachedKey = "";
  const resolveData = () => {
    const config = getConfig() ?? {};
    const apiKey = typeof config.apiKey === "string" ? config.apiKey.trim() : "";
    if (!apiKey) return null;
    const baseUrl = (typeof config.baseUrl === "string" && config.baseUrl.trim()) || DEFAULT_BASE_URL;
    const key = apiKey + "\n" + baseUrl + "\n" + String(config.compileStatusFile ?? "");
    if (key !== cachedKey) {
      cachedData = createData({ apiKey, baseUrl, compileStatusFile: config.compileStatusFile ?? null });
      cachedKey = key;
    }
    return cachedData;
  };

  const handlers = makeRouteHandlers(resolveData, { getConfig });
  const fence = (req) => {
    let connection;
    try {
      // An undeclared Cordis property can throw; that is not "no host
      // connection" (which is undefined and falls back to the loopback check),
      // so it fails closed.
      connection = serviceOf(ctx, "connection");
    } catch {
      return 403;
    }
    try {
      if (connection && typeof connection.requestRejection === "function") {
        const rejection = connection.requestRejection(req);
        return rejection === undefined ? undefined : rejection;
      }
      return localHostFence(req) ? undefined : 403;
    } catch {
      // Fencing must fail closed, never take the route down with a 400.
      return 403;
    }
  };

  const disposers = [];
  const mounts = [
    ["/obsidian/api/list", handlers.list],
    ["/obsidian/api/search", handlers.search],
    ["/obsidian/api/read", handlers.read],
    ["/obsidian/graph", handlers.graph],
    ["/obsidian/graph-page", handlers.graphPage],
    ["/obsidian/vis-network.min.js", handlers.graphLib],
    ["/obsidian/compile-status", handlers.compileStatus],
  ];
  for (const [path, handler] of mounts) {
    disposers.push(
      ctx.effect(() =>
        ctx.webServer.register({
          kind: "exact",
          path,
          handler: async (req, res) => {
            const rejection = fence(req);
            if (rejection !== undefined) {
              // requestRejection yields 401/403; anything else (including a
              // thrown/opaque result) is a forbidden request, never a 400.
              const status = rejection === 401 ? 401 : 403;
              writeError(
                res,
                status,
                status === 401 ? UNAUTHORIZED_CODE : FORBIDDEN_CODE,
                "request rejected by the host connection policy",
              );
              return;
            }
            try {
              await handler(req, res);
            } catch (err) {
              // The web server answers an empty 400 when a route handler
              // rejects; keep the cause visible and the envelope consistent.
              console.warn(`[dsh-learn-everything] obsidian route ${path} failed:`, err?.stack || err);
              if (!res.headersSent) writeError(res, 500, "obsidian-route", String(err?.message || err));
              else res.destroy();
            }
          },
        }),
        "dsh-learn-everything: /obsidian route " + path,
      ),
    );
  }
  return disposers;
}
