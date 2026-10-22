// Search retriever (P4): wiki-first, source verification, structural queries.
// Produces a normalized result list with real paths and evidence excerpts.

// Common Chinese/English interrogatives and particles that Obsidian simple
// search would AND-match to zero hits. Stripped before per-term fallback.
const STOPWORDS = [
  "什么是", "怎么", "如何", "为什么", "解释", "介绍", "概念", "区别", "关系", "原理",
  "的", "了", "和", "与", "吗", "呢", "一个", "哪些", "有没有",
  "what", "how", "why", "explain", "the", "a", "is",
];

function extractTerms(query) {
  const cleaned = query
    .toLowerCase()
    .replace(/[，。？！、；：“”‘’（）()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const raw = cleaned.split(" ").filter(Boolean);
  const terms = [];
  for (const w of raw) {
    const stripped = STOPWORDS.reduce((acc, s) => acc.split(s).join(""), w);
    if (stripped.length >= 2 && !terms.includes(stripped)) terms.push(stripped);
  }
  return terms.slice(0, 3);
}

export class SearchRetriever {
  constructor({ adapter, wikiDir = "wiki" }) {
    this.adapter = adapter;
    this.wikiDir = wikiDir;
  }

  // Run Obsidian simple search and normalize hits.
  // Falls back to per-term search when the full query AND-matches nothing.
  async _search(query, { max = 10 } = {}) {
    let hits = await this.adapter.search(query);
    if (!Array.isArray(hits) || hits.length === 0) {
      const seen = new Map();
      for (const term of extractTerms(query)) {
        const termHits = await this.adapter.search(term);
        for (const item of Array.isArray(termHits) ? termHits : []) {
          if (!seen.has(item.filename)) seen.set(item.filename, item);
        }
      }
      hits = [...seen.values()];
    }
    if (!Array.isArray(hits)) return [];
    return hits.slice(0, max).map((h) => ({
      path: h.filename,
      score: h.score ?? 0,
      excerpt: (h.matches ?? []).slice(0, 2).map((m) => (m.context ?? "").slice(0, 200)).join(" \u2026 "),
    }));
  }

  // Wiki-first retrieval: prefer compiled wiki pages, then source notes.
  async wikiFirst(query, { max = 10 } = {}) {
    const hits = await this._search(query, { max: max * 3 });
    const results = [];
    for (const h of hits) {
      const isWiki = h.path.startsWith(this.wikiDir + "/");
      if (h.path === "wiki/log.md" || h.path === "wiki/index.md" || h.path.startsWith("wiki/schema/")) continue;
      results.push({
        title: h.path.split("/").pop().replace(/\.md$/, ""),
        path: h.path,
        resultType: isWiki ? "wiki_page" : h.path.startsWith("Sources/") || h.path.startsWith("Inbox/") ? "source_note" : "search_result",
        excerpt: h.excerpt,
        retrievalMethod: "simple_search",
        confidence: "candidate",
      });
    }
    // Wiki pages first, then source notes, then the rest.
    const rank = { wiki_page: 0, source_note: 1, search_result: 2 };
    return results.sort((a, b) => rank[a.resultType] - rank[b.resultType]).slice(0, max);
  }

  // Read a note to verify an exact fact or get full context.
  async readNote(path) {
    return this.adapter.read(path);
  }

  // Structural query: list tags or list files under a folder.
  async structural(query) {
    const q = query.toLowerCase();
    if (q.includes("标签") || q.includes("tag")) {
      return { kind: "tags", items: await this._tags() };
    }
    return { kind: "files", items: await this._listAll() };
  }

  async _tags() {
    // tag_list is an MCP tool; expose via adapter hook when available.
    if (typeof this.adapter.tags === "function") return this.adapter.tags();
    return [];
  }

  async _listAll() {
    const { files } = await this.adapter.list("");
    return files ?? [];
  }
}
