---
name: remember-knowledge
description: "知识摄入工作流（/记住知识）：抓取 URL 或本地 Markdown → 预检（内容哈希+wiki 查重）→ 用户确认 → 写入 Sources/（仅 create，绝不覆盖）→ karpathywiki 编译 → 校验与报告。当用户要保存一篇网页、一篇文章或一段 Markdown 到知识库时使用。"
---

# /记住知识：知识摄入

把外部材料（URL / 本地 Markdown）安全地收进知识库，并用 karpathywiki 编译成互链 Wiki。

## 硬性门禁（不可违反）
- **未确认不写入**：预检后、写入前各一次确认；用户未明确同意，禁止调用任何写操作。
- **只 create**：第一版只允许新建笔记（`If-None-Match: *`，目标已存在则 412 → needs_review），不覆盖、不追加、不合并。
- **URL 安全**：只允许 https；拒绝 file:// 与内网地址（协议校验在 source-fetch 内）；限制大小与超时。
- **幂等**：内容哈希在 `code/.state/sources.json` 注册表查重；同源重复直接提示，不重复摄入。
- **失败可恢复**：任务状态落盘（code/.state/）；失败不产生半成品。

## 工作流
1. **获取**：`node scripts/ingest-cli.mjs <url|本地md> --auto-yes` 可跑全流程；无 `--auto-yes` 时每步确认。
2. **预检**：显示标题、来源、内容哈希、重复情况（精确哈希重复 / wiki/sources 同 slug 页）、目标路径。
3. **确认①**：用户确认摄入范围与目标。
4. **计划**：生成 `Sources/<slug>.md`（frontmatter 含 source_uri/source_id/content_hash/fetched_at）。
5. **确认②**：用户确认写入计划。
6. **写入**：create-only 写入 Sources/。
7. **校验**：读回内容完整性。
8. **编译**：open_file + ingest-active-file 触发 karpathywiki，阻塞等待 wiki 页出现（超时/轮询可配：OBSIDIAN_INGEST_TIMEOUT_MS / OBSIDIAN_INGEST_POLL_INTERVAL_MS）。
9. **报告**：新增/更新/失败清单 + 任务状态。

## 底层模块（code/src/ingest/）
- `source-fetch.js`：URL/本地获取 + 规范化 + sha256
- `preflight.js`：查重（哈希精确 + wiki slug 相似）
- `planner.js` / `pipeline.js`：create-only 计划与编排（含两段确认门禁）
- `registry.js` / `task-state.js`：来源注册表与任务状态（持久化 JSON）

## 注意
- 摄入耗时 ~6 分钟/源（karpathywiki LLM 编译），阻塞等待用长超时。
- 测试源/产物若要清理，需用户明确同意后删除（禁止自动删除）。
