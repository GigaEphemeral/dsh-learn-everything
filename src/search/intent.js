// Query intent classifier for the search router (P4).
// Rule-based: concept exploration, exact-source lookup, structural query,
// or combined. Kept deterministic and testable (no LLM involved).

export const INTENTS = ["concept", "source", "structure", "combined"];

// ASCII markers are matched on word boundaries so short English words do not
// fire inside longer words ("how" in "show", "code" in "decode"). CJK markers
// are matched as substrings because Chinese has no word separators (E7).
const ASCII_MARKER = /^[\x00-\x7F]+$/;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Precompile markers once at module load: CJK as plain substrings, ASCII as
// word-boundary regexes.
function compileMarkers(markers) {
  return markers.map((marker) =>
    ASCII_MARKER.test(marker)
      ? { test: new RegExp(`\\b${escapeRegExp(marker)}\\b`, "i") }
      : { includes: marker },
  );
}

function anyMarkerHits(markers, query) {
  return markers.some((marker) => (marker.test ? marker.test.test(query) : query.includes(marker.includes)));
}

const CONCEPT_MARKERS = compileMarkers([
  "什么是", "概念", "解释", "区别", "关系", "原理", "为什么", "如何", "介绍",
  "definition", "explain", "difference", "relation", "principle", "why", "how",
]);
// Single-char "值" was too broad (值得/价值观/阈值), so only multi-char value
// markers are kept (E8).
const SOURCE_MARKERS = compileMarkers([
  "配置", "参数", "版本", "数字", "代码", "命令", "取值", "默认值", "值是", "出处", "原文",
  "config", "param", "version", "value", "code", "command", "source",
]);
const STRUCTURE_MARKERS = compileMarkers([
  "标签", "目录", "有哪些", "清单", "列表", "主题",
  "tag", "folder", "list", "index", "topic",
]);

export function classifyIntent(query) {
  // Guard: a missing, non-string, or blank query carries no intent signal.
  // Return "combined" (the fallback used when no single intent dominates)
  // instead of throwing, so one bad input cannot break the whole search CLI.
  if (typeof query !== "string" || query.trim() === "") return "combined";
  const q = query.toLowerCase();
  const hits = {
    concept: anyMarkerHits(CONCEPT_MARKERS, q),
    source: anyMarkerHits(SOURCE_MARKERS, q),
    structure: anyMarkerHits(STRUCTURE_MARKERS, q),
  };
  const count = Object.values(hits).filter(Boolean).length;
  if (count === 0) return "combined";
  if (count > 1) return "combined";
  return hits.concept ? "concept" : hits.source ? "source" : "structure";
}
