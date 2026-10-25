---
name: obs-access
description: "在 DSH 内只读访问 Obsidian 知识库：搜索、查看节点、知识图谱、跳转原文、编译进度。"
---

# /obs-access：Obsidian 访问面板

只用原生工具；不要运行 shell、不要拼路径。所有操作只读，不修改 vault。

1. **搜索**：\`obs_vault\` action=\`search\`，query=\`<关键词>\`（返回证据与充分性）。
2. **查看节点**：\`obs_vault\` action=\`node\`，name=\`<节点名>\` 或 \`random\`（节点正文、来源与学习摘要）。
3. **知识图谱**：\`obs_vault\` action=\`graph\`（返回 nodes / edges）；展示节点清单，并为每个节点给
   \`obsidian://open?vault=<vault>&file=<path>\` 跳转链接。
4. **编译进度**：\`obs_compile\` action=\`status\`（可带 path 看某来源是否已出 wiki 页）；
   \`obs_compile\` action=\`pending\` 列出尚未编译的来源。
5. **vault 变更 / 面板**：右侧栏 Obsidian tab 提供目录、搜索、笔记预览、图谱与编译进度；
   不在对话里轮询事件流。

## 纪律
- 引用真实路径，不编造笔记内容。
- 操作只读；不删除、不覆盖 vault 文件。
