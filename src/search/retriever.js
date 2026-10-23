// Search retriever (P4): wiki-first, source verification, structural queries.
// Produces a normalized result list with real paths and evidence excerpts.

import { ObsidianError } from "../obsidian/obsidian-client.js";
import { normalizeEvidence } from "./evidence.js";

// ASCII stopwords are removed only when a space-delimited token matches one
// exactly ("data" and "theory" must survive despite containing "a"/"the").
const ASCII_STOPWORDS = new Set(["what", "how", "why", "explain", "the", "a", "is"]);

// CJK words have no spaces, so interrogatives are stripped at token boundaries
// only, and only when at least two characters remain ("目的" must survive).
const CJK_PREFIXES = ["什么是", "怎么", "如何", "为什么", "解释", "介绍", "概念", "区别", "关系", "原理", "哪些", "有没有"];
const CJK_SUFFIXES = ["是什么意思", "是什么", "有哪些", "吗", "呢", "的", "了"];
const CJK_STOPWORDS = new Set(["的", "了", "和", "与", "吗", "呢", "哪些", "有没有", "一个", "什么"]);

const MIN_TERM_LENGTH = 2;
const MAX_TERMS = 3;
const TERM_SEPARATORS = /[，。？！、；：“”‘’（）()]/g;

// Remove leading interrogatives and trailing question particles from one token,
// never leaving a single character behind (which is how "目的" used to become
// "目") (E12).
function stripBoundaryWords(token) {
  let term = token;
  for (const prefix of CJK_PREFIXES) {
    if (term.startsWith(prefix) && term.length - prefix.length >= MIN_TERM_LENGTH) {
      term = term.slice(prefix.length);
      break;
    }
  }
  for (const suffix of CJK_SUFFIXES) {
    if (term.endsWith(suffix) && term.length - suffix.length >= MIN_TERM_LENGTH) {
      term = term.slice(0, -suffix.length);
      break;
    }
  }
  return term;
}

function extractTerms(query) {
  const cleaned = query.toLowerCase().replace(TERM_SEPARATORS, " ").replace(/\s+/g, " ").trim();
  const raw = cleaned.split(" ").filter(Boolean);
  const terms = [];
  for (const token of raw) {
    if (ASCII_STOPWORDS.has(token)) continue;
    const term = stripBoundaryWords(token);
    if (term.length < MIN_TERM_LENGTH || CJK_STOPWORDS.has(term) || terms.includes(term)) continue;
    terms.push(term);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

export class SearchRetriever {
  constructor({ adapter, wikiDir = "wiki" }) {
    this.adapter = adapter;
    // Normalize the layout prefix so exclusion checks can append "/" safely.
    this.wikiDir = wikiDir.replace(/^\/+|\/+$/g, "") || "wiki";
  }

  // Wrap adapter search failures with the query being attempted, keeping the
  // original error as `cause` for diagnostics (E16).
  async _callSearch(query) {
    try {
      return await this.adapter.search(query);
    } catch (cause) {
      throw new Error(`search failed for query "${query}": ${cause?.message ?? String(cause)}`, { cause });
    }
  }

  // Run Obsidian simple search and normalize hits.
  // Falls back to per-term search when the full query AND-matches nothing.
  // The fallback searches are independent, so they run in parallel (E13);
  // merging stays deterministic because Promise.all preserves term order and
  // the first hit for a filename wins.
  async _search(query, { max = 10 } = {}) {
    let hits = await this._callSearch(query);
    if (!Array.isArray(hits) || hits.length === 0) {
      const terms = extractTerms(query);
      const perTerm = await Promise.all(terms.map((term) => this._callSearch(term)));
      const seen = new Set();
      const merged = [];
      for (const termHits of perTerm) {
        for (const item of Array.isArray(termHits) ? termHits : []) {
          if (seen.has(item.filename)) continue;
          seen.add(item.filename);
          merged.push(item);
        }
      }
      hits = merged;
    }
    if (!Array.isArray(hits)) return [];
    return hits.slice(0, max).map((h) => ({
      path: h.filename,
      score: h.score ?? 0,
      excerpt: (h.matches ?? []).slice(0, 2).map((m) => (m.context ?? "").slice(0, 200)).join(" \u2026 "),
    }));
  }

  // Wiki log/index/schema files are navigation artifacts, never evidence.
  // They are excluded relative to the configured wikiDir (E14).
  _isExcluded(path) {
    const prefix = `${this.wikiDir}/`;
    if (!path.startsWith(prefix)) return false;
    const rest = path.slice(prefix.length);
    return rest === "log.md" || rest === "index.md" || rest.startsWith("schema/");
  }

  // Wiki-first retrieval: prefer compiled wiki pages, then source notes.
  async wikiFirst(query, { max = 10 } = {}) {
    const hits = await this._search(query, { max: max * 3 });
    const results = [];
    for (const h of hits) {
      if (this._isExcluded(h.path)) continue;
      const isWiki = h.path.startsWith(`${this.wikiDir}/`);
      results.push(normalizeEvidence({
        path: h.path,
        title: h.path.split("/").pop().replace(/\.md$/, ""),
        excerpt: h.excerpt,
        retrievalMethod: "simple_search",
        resultType: isWiki ? "wiki_page" : undefined,
      }));
    }
    // Wiki pages first, then source notes, then the rest.
    const rank = { wiki_page: 0, source_note: 1, search_result: 2 };
    return results.sort((a, b) => rank[a.resultType] - rank[b.resultType]).slice(0, max);
  }

  // Read a note to verify an exact fact or get full context. A 404 is a normal
  // negative lookup, not a transport failure, so it resolves to null (E17);
  // other errors still surface.
  async readNote(path) {
    try {
      return await this.adapter.read(path);
    } catch (err) {
      if (err instanceof ObsidianError && err.status === 404) return null;
      throw err;
    }
  }

  // Structural query: list tags or list files under a folder.
  async structural(query) {
    const q = query.toLowerCase();
    if (q.includes("标签") || q.includes("tag")) {
      return { kind: "tags", items: await this._tags() };
    }
    // Query-aware: list the wiki/Sources directory the query asks about.
    const dir = this._structuralDir(q);
    const res = dir ? await this.adapter.list(dir) : await this.adapter.list("");
    const items = Array.isArray(res?.files) ? res.files : [];
    return { kind: "files", dir, items };
  }

  // Which directory does a structural query target? Wiki dirs win over the
  // root listing; a generic "structure" query falls back to the root.
  _structuralDir(q) {
    if (q.includes("概念")) return "wiki/concepts";
    if (q.includes("实体")) return "wiki/entities";
    if (q.includes("来源")) return "wiki/sources";
    if (q.includes("source") || q.includes("original") || q.includes("原文")) return "wiki/sources";
    return null;
  }

  async _tags() {
    // tag_list is an MCP tool; expose via adapter hook when available.
    if (typeof this.adapter.tags === "function") return this.adapter.tags();
    return [];
  }

  // A malformed or empty list response must degrade to an empty catalog
  // instead of throwing a TypeError (E15).
  async _listAll() {
    const res = await this.adapter.list("");
    return Array.isArray(res?.files) ? res.files : [];
  }
}
