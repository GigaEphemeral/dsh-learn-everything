// Query intent classifier for the search router (P4).
// Rule-based: concept exploration, exact-source lookup, structural query,
// or combined. Kept deterministic and testable (no LLM involved).

export const INTENTS = ["concept", "source", "structure", "combined"];

const CONCEPT_MARKERS = [
  "什么是", "概念", "解释", "区别", "关系", "原理", "为什么", "如何", "介绍",
  "definition", "explain", "difference", "relation", "principle", "why", "how",
];
const SOURCE_MARKERS = [
  "配置", "参数", "版本", "数字", "代码", "命令", "值", "出处", "原文",
  "config", "param", "version", "value", "code", "command", "source",
];
const STRUCTURE_MARKERS = [
  "标签", "目录", "有哪些", "清单", "列表", "主题",
  "tag", "folder", "list", "index", "topic",
];

export function classifyIntent(query) {
  const q = query.toLowerCase();
  const hits = {
    concept: CONCEPT_MARKERS.some((m) => q.includes(m.toLowerCase())),
    source: SOURCE_MARKERS.some((m) => q.includes(m.toLowerCase())),
    structure: STRUCTURE_MARKERS.some((m) => q.includes(m.toLowerCase())),
  };
  const count = Object.values(hits).filter(Boolean).length;
  if (count === 0) return "combined";
  if (count > 1) return "combined";
  return hits.concept ? "concept" : hits.source ? "source" : "structure";
}
