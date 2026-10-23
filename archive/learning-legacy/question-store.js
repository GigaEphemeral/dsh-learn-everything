// Question store (P5): create and list questions as vault Markdown files
// under Learning/Questions/. Each question carries the plan's frontmatter
// contract plus 题干/参考答案/评分标准/相关知识 sections.

export function buildQuestionMarkdown({ questionId, type, topic, sourceNotes = [], difficulty = 2, prompt, reference, rubric = [], related = [] }) {
  const fm = [
    "---",
    `question_id: ${JSON.stringify(questionId)}`,
    `type: ${JSON.stringify(type)}`,
    `topic: ${JSON.stringify(topic)}`,
    "source_notes:",
    ...sourceNotes.map((n) => `  - "${n}"`),
    `difficulty: ${difficulty}`,
    "status: active",
    `created_at: ${JSON.stringify(new Date().toISOString().slice(0, 10))}`,
    "---",
    "",
    `# 题目：${topic}`,
    "",
    "## 题干",
    prompt,
    "",
    "## 参考答案",
    reference,
    "",
    "## 评分标准",
    ...(rubric.length ? rubric.map((r) => `- ${r}`) : ["- 自行判断"]),
    "",
    "## 相关知识",
    ...(related.length ? related.map((r) => `- [[${r}]]`) : []),
    "",
  ];
  return fm.join("\n");
}

export function questionPath(topic) {
  const slug = topic.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "");
  return `Learning/Questions/${slug}.md`;
}
