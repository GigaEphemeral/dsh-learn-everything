---
name: knowledge-search
description: "知识检索工作流（/知识检索）：判断查询意图（概念探索/原文溯源/结构查询/综合），Wiki 优先召回，原文核验，输出带真实路径与证据摘录的结果。当用户要查询知识库、解释概念、找原文出处或看某主题有哪些内容时使用。"
---

# /知识检索：知识检索

以 Wiki 图谱产物优先、原文为证据的检索流程。

## 检索策略（按意图路由）
- **概念探索**（什么是/解释/区别/原理…）：先 `wikiFirst` 命中概念页，再读相关 source 页核验
- **原文溯源**（配置/参数/版本/数字/代码…）：直接查 Sources/Inbox 原文，读取精确片段
- **结构查询**（标签/目录/有哪些…）：tag_list / 目录列表
- **综合问题**：wikiFirst + 原文核验并行

## 命令
```bash
cd code && OBSIDIAN_API_KEY=... node scripts/search-cli.mjs "什么是间隔重复"
cd code && OBSIDIAN_API_KEY=... node scripts/search-cli.mjs "复习间隔 配置"
```

## 纪律
- 引用必须指向真实存在的笔记路径（wiki/sources/…、Sources/…）；禁止编造路径或行号
- 证据不足时明确说明，不凭摘要推断精确事实
- 检索失败/超时如实报告，不静默返回虚构结果
- 统一结果格式：title/path/resultType/excerpt/retrievalMethod/confidence
