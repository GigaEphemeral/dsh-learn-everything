---
name: obs-remember-knowledge
description: "把 URL 或本地 Markdown 摄入 Obsidian 知识库：预检 → 确认 → create-only 写入 Sources（可放入多级目录）→ 按需编译。"
---

# /obs-remember-knowledge：知识摄入

全程只调用本插件的原生工具。不要运行 shell，不要构造路径，也不要查找仓库、源码或 .env：
所有读写都由宿主执行，Windows / macOS / Linux 表现一致。
插件设置「允许摄入」关闭时，写入会被拒绝（预检仍可用）。

## 流程
1. **预检**：调用 \`obs_ingest\`，action=\`preflight\`，target=\`<url|本地md>\`，可选 dir=\`Sources/<目录>\`。
   返回：标题、来源、内容哈希、重复情况、目标路径与警告。
2. **确认**：把预检结果（尤其目标路径与重复情况）给用户看，等明确同意。
3. **写入**：用户同意后再次调用 \`obs_ingest\`，action=\`write\`，参数同第 1 步，并带
   \`confirm: true\` 与 \`expectedHash\`=\`<第 1 步的 contentHash>\`。只 create、不覆盖；
   目标已存在会返回 needs_review，此时停下报告，不要改用其他方式硬写。
4. **报告**：返回的 status / targetPath / warnings 如实汇报；失败就说失败。
5. **编译（默认关闭，可选）**：需要时调用 \`obs_compile\` action=\`trigger\`（path=\<targetPath\>），
   再用 action=\`status\`（带同一 path）轮询结果。编译约 6~15 分钟且可能被后端限流，
   不要密集重触发；来源笔记已安全入库，未编译不影响它。

## 纪律
- 未确认不写入：\`confirm: true\` 只出现在用户明确同意之后。
- 多级目录（如 \`Sources/复盘/2026\`）由写入自动创建，不需要单独建目录。
- 不写 Obsidian 之外的任何文件；工具的读回校验与任务状态负责失败可恢复。
