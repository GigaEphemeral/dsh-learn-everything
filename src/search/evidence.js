// Unified evidence model and sufficiency judgment (S1).
// Every retrieval hit is normalized into a stable shape that preserves the
// real source (path, source note, excerpt, retrieval method) so answers can
// cite actual notes. Sufficiency is rule-based: exact-fact questions need
// original source evidence; concept questions can rely on wiki pages.

export function normalizeEvidence({ path, title, excerpt, retrievalMethod, resultType, location = null }) {
  const isWiki = path.startsWith("wiki/");
  const isSource = path.startsWith("Sources/") || path.startsWith("Inbox/");
  return {
    title: title ?? path.split("/").pop().replace(/\.md$/, ""),
    path,
    resultType: resultType ?? (isWiki ? "wiki_page" : isSource ? "source_note" : "search_result"),
    sourceNote: isSource ? path : null,
    location,
    excerpt,
    retrievalMethod,
    confidence: "candidate", // rule-based ranking, never a model probability
  };
}

// Sufficiency levels: none | partial | supported.
export function assessSufficiency(question, evidence, { exactFact = false } = {}) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return { sufficient: false, level: "none", gaps: ["无任何检索证据"] };
  }
  const wiki = evidence.filter((e) => e.resultType === "wiki_page");
  const sources = evidence.filter((e) => e.resultType === "source_note");
  if (exactFact && sources.length === 0) {
    return { sufficient: false, level: "partial", gaps: ["精确事实需要原文来源证据（Sources/Inbox），当前仅有 wiki/普通结果"] };
  }
  if (sources.length > 0 || wiki.length > 0) {
    return { sufficient: true, level: "supported", gaps: [] };
  }
  return { sufficient: false, level: "partial", gaps: ["仅普通搜索结果，尚未核验来源"] };
}
