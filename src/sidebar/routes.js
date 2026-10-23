// R2 sidebar data routes (S4): serve Obsidian knowledge data to the panel
// client over same-origin fenced routes. The Obsidian API key stays in the
// backend; the browser never sees it. Route contract mirrors the host
// SidebarWebRoute ({ kind, path, handler }) and fences every request with
// ctx.connection.requestRejection.

import { ObsidianClient, ObsidianAdapter, ObsidianError } from "../obsidian/obsidian-adapter.js";
import { SearchRetriever } from "../search/retriever.js";
import { classifyIntent, INTENT } from "../search/intent.js";
import { assessSufficiency } from "../search/evidence.js";
import { buildGraph } from "../wiki/graph.js";
import { readCompileStatus } from "../obsidian/compile-status.js";
import { WIKI_DIRS } from "../wiki/karpathy-driver.js";

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  }
  return raw;
}

function writeJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function writeError(res, status, code, message) {
  writeJson(res, status, { ok: false, error: { code, message } });
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
export function createObsidianData({ apiKey, baseUrl = "https://127.0.0.1:27124", compileStatusFile = null }) {
  const client = new ObsidianClient({ baseUrl, apiKey });
  const adapter = new ObsidianAdapter(client);
  const retriever = new SearchRetriever({ adapter });
  return { client, adapter, retriever, compileStatusFile };
}

// Route handlers keyed by name; each (req, res) writes its JSON envelope.
export function makeRouteHandlers(data) {
  const handlers = {};

  handlers.list = async (req, res) => {
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
    const path = queryParams(req.url).get("path") ?? "";
    if (!path) return writeError(res, 400, "bad-request", "path is empty");
    try {
      const content = await data.adapter.read(path);
      if (content === null) writeError(res, 404, "not-found", "note " + path + " not found");
      else writeJson(res, 200, { ok: true, value: { path, content } });
    } catch (err) {
      writeError(res, 500, "obsidian-read", err.message);
    }
  };

  handlers.graph = async (req, res) => {
    try {
      const pages = [];
      for (const dir of WIKI_DIRS) {
        let files = [];
        try {
          const r = await data.adapter.list(dir);
          files = r?.files ?? [];
        } catch (err) {
          if (err instanceof ObsidianError && err.status === 404) files = [];
          else throw err;
        }
        for (const f of files) {
          const content = await data.adapter.read(dir + "/" + f);
          if (typeof content === "string") pages.push({ path: dir + "/" + f, content });
        }
      }
      writeJson(res, 200, { ok: true, value: buildGraph(pages) });
    } catch (err) {
      writeError(res, 500, "obsidian-graph", err.message);
    }
  };

  handlers.compileStatus = async (req, res) => {
    try {
      const filePath = queryParams(req.url).get("file") ?? data.compileStatusFile;
      const status = filePath ? await readCompileStatus(filePath) : { stages: [], last: null };
      writeJson(res, 200, { ok: true, value: status });
    } catch (err) {
      writeError(res, 500, "obsidian-compile-status", err.message);
    }
  };

  return handlers;
}

// Register every route with host fencing. Returns route registration disposers.
export function registerObsidianRoutes(ctx, { apiKey, baseUrl, compileStatusFile = null }) {
  const data = createObsidianData({ apiKey, baseUrl, compileStatusFile });
  const handlers = makeRouteHandlers(data);
  if (typeof ctx?.webServer?.register !== "function" || typeof ctx?.connection?.requestRejection !== "function") {
    return [];
  }
  const fence = (req) => ctx.connection.requestRejection(req) === undefined;
  const disposers = [];
  const mounts = [
    ["/obsidian/api/list", handlers.list],
    ["/obsidian/api/search", handlers.search],
    ["/obsidian/api/read", handlers.read],
    ["/obsidian/graph", handlers.graph],
    ["/obsidian/compile-status", handlers.compileStatus],
  ];
  for (const [path, handler] of mounts) {
    disposers.push(
      ctx.effect(() =>
        ctx.webServer.register({
          kind: "exact",
          path,
          handler: (req, res) => {
            if (!fence(req)) {
              writeError(res, 403, "forbidden", "request rejected by host connection policy");
              return;
            }
            return handler(req, res);
          },
        }),
        "dsh-learn-everything: /obsidian route " + path,
      ),
    );
  }
  return disposers;
}
