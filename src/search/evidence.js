// Unified evidence model and sufficiency judgment (S1).
// Every retrieval hit is normalized into a stable shape that preserves the
// real source (path, source note, excerpt, retrieval method) so answers can
// cite actual notes. Sufficiency is rule-based: exact-fact questions need
// original source evidence; concept questions can rely on wiki pages.

// Classification prefixes are lowercase; paths are normalized before matching
// so "Wiki/..." and "wiki\..." are both recognized (E2).
const WIKI_PREFIX = "wiki/";
const SOURCE_PREFIXES = ["sources/", "inbox/"];

// Normalize separators for classification and title derivation; the reported
// path stays exactly as the caller provided it.
function normalizeSeparators(path) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

// Classification additionally ignores case so "Wiki/" matches "wiki/".
function normalizePathForClassification(path) {
  return normalizeSeparators(path).toLowerCase();
}

function defaultResultType(normalizedPath) {
  if (normalizedPath.startsWith(WIKI_PREFIX)) return "wiki_page";
  if (SOURCE_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))) return "source_note";
  return "search_result";
}

export function normalizeEvidence({ path, title, excerpt, retrievalMethod, resultType, location = null }) {
  // A missing or non-string path would throw an unclear TypeError when the
  // batch is classified; reject it explicitly instead (E1).
  if (typeof path !== "string" || path.trim() === "") {
    throw new TypeError("normalizeEvidence: path must be a non-empty string");
  }
  const normalizedPath = normalizePathForClassification(path);
  // Derive sourceNote from the resolved type so an explicit resultType cannot
  // contradict sourceNote (E3).
  const resolvedType = resultType ?? defaultResultType(normalizedPath);
  const titleFromPath = normalizeSeparators(path).split("/").pop().replace(/\.md$/i, "");
  return {
    title: title ?? titleFromPath,
    path,
    resultType: resolvedType,
    sourceNote: resolvedType === "source_note" ? path : null,
    location,
    excerpt,
    retrievalMethod,
    confidence: "candidate", // rule-based ranking, never a model probability
  };
}

// Sufficiency levels: none | partial | supported.
// `question` is reserved for future relevance scoring; kept for signature
// stability so callers do not need to change (E4).
export function assessSufficiency(question, evidence, { exactFact = false } = {}) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return { sufficient: false, level: "none", gaps: ["无任何检索证据"] };
  }
  // A hit without a usable excerpt cannot support an answer, so only evidence
  // with at least one non-empty excerpt counts toward sufficiency (E4).
  const usable = evidence.filter((e) => typeof e?.excerpt === "string" && e.excerpt.trim() !== "");
  if (usable.length === 0) {
    return { sufficient: false, level: "partial", gaps: ["检索命中缺少可用摘录，无法支撑答案"] };
  }
  const wiki = usable.filter((e) => e.resultType === "wiki_page");
  const sources = usable.filter((e) => e.resultType === "source_note");
  if (exactFact && sources.length === 0) {
    return { sufficient: false, level: "partial", gaps: ["精确事实需要原文来源证据（Sources/Inbox），当前仅有 wiki/普通结果"] };
  }
  if (sources.length > 0 || wiki.length > 0) {
    return { sufficient: true, level: "supported", gaps: [] };
  }
  return { sufficient: false, level: "partial", gaps: ["仅普通搜索结果，尚未核验来源"] };
}
