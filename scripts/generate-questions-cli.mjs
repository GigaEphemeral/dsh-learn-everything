// Generate concept questions from wiki concept pages (P5 helper).
// No LLM: each wiki concept's definition becomes a reference answer, so the
// bank fills from the compiled knowledge. Writes to Learning/Questions/.
// Usage: OBSIDIAN_API_KEY=... node scripts/generate-questions-cli.mjs [--dry-run]

import { ObsidianClient, ObsidianAdapter, ObsidianError } from "../src/obsidian/obsidian-adapter.js";
import { buildQuestionMarkdown, questionPath } from "../src/learning/question-store.js";

const apiKey = process.env.OBSIDIAN_API_KEY;
const dryRun = process.argv.includes("--dry-run");
if (!apiKey) {
  console.error("usage: OBSIDIAN_API_KEY=... node scripts/generate-questions-cli.mjs [--dry-run]");
  process.exit(1);
}

const client = new ObsidianClient({ baseUrl: "https://127.0.0.1:27124", apiKey });
const adapter = new ObsidianAdapter(client);

function extractFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/"/g, "");
  }
  return fm;
}

const { files } = await adapter.list("wiki/concepts");
let created = 0, skipped = 0;
for (const f of files ?? []) {
  const content = await adapter.read(`wiki/concepts/${f}`);
  const fm = extractFrontmatter(content);
  const title = f.replace(/\.md$/, "");
  const def = content.split("## 定义")[1]?.split("## ")[0]?.trim();
  if (!def) { skipped += 1; continue; }
  const target = questionPath(title);
  const md = buildQuestionMarkdown({
    questionId: `q_${Date.now()}_${created}`, type: "concept", topic: title,
    sourceNotes: fm.sources ? JSON.parse(fm.sources.replace(/[[\]"']/g, "").split(",").map(s => s.trim()).filter(Boolean).map(s => `[[${s}]]`).join(",")) : [],
    prompt: `请用自己的话解释「${title}」，并说明它在本知识体系中的作用或与其他概念的关系。`,
    reference: def,
    rubric: ["是否准确涵盖核心定义", "是否说明与相关概念的关系", "是否用自己的话而非照抄"],
    related: [title],
  });
  if (dryRun) {
    console.log(`[dry] would create ${target}`);
    created += 1;
    continue;
  }
  try {
    await adapter.create(target, md);
    console.log(`created ${target}`);
    created += 1;
  } catch (err) {
    if (err instanceof ObsidianError && err.status === 412) {
      skipped += 1; // already exists
    } else {
      throw err;
    }
  }
}
console.log(`done: created ${created}, skipped ${skipped}`);
process.exit(0);
