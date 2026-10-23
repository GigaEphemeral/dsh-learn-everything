---
name: obsidian-access
description: "Obsidian 访问面板（/obsidian）：在 DSH 会话内直接访问知识库——列表、搜索、查看笔记、知识图谱、跳转原文、vault 变更与编译进度通知。当用户要查看知识库、查笔记、看图谱、关注编译进度或 vault 变更时使用。"
---

# /obsidian：Obsidian 访问面板（会话内）

在 DSH 内直接访问 Obsidian 知识库，不必切到 Obsidian 应用。全部通过本地 REST API 与已验证 CLI（只读）。

## 可用操作

1. **知识库列表**：列出 wiki/concepts、wiki/entities、wiki/sources、Sources 的内容清单；单节点用 `node --env-file=.env scripts/wiki-node-cli.mjs show <name>`。
2. **搜索**：`node --env-file=.env scripts/search-cli.mjs "<query>"`（返回证据+充分性）；可再用 Obsidian 模糊搜索（POST /search/simple）补全。
3. **查看笔记**：读任意笔记正文（wiki 页 / Sources 原文）并在对话中呈现 markdown（引用真实路径）。
4. **知识图谱**：`node --env-file=.env scripts/wiki-graph.mjs` 返回 {nodes, edges}；展示节点清单/结构；每个节点给 `obsidian://open?vault=learnEverything&file=<path>` 跳转链接；可选打开浏览器图谱视图：`xdg-open code/panel/graph.html?data=<encodeURIComponent(json)>`。
5. **跳转原文**：任何笔记/节点都提供 obsidian:// URI 链接（点击在 Obsidian 打开对应笔记）。
6. **通知**：
   - vault 变更：`node --env-file=.env scripts/events-cli.mjs <create|modify|delete> <秒>` 订阅事件流并报告变更；
   - 编译进度：`node --env-file=.env scripts/compile-cli.mjs status` 查看 karpathywiki 编译状态（pending/triggered/waiting/done/timeout/error）；摄入/编译流程中主动报告进度。

## 纪律
- 引用真实路径；不编造笔记内容。
- obsidian:// URI 仅用于跳转；所有操作只读，不修改 vault。
- 图谱/通知数据均来自本地 REST（事件流、搜索、目录、wiki 页）。
