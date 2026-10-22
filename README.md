# DSH + Obsidian 学习系统 · 源码（code/）

> 双语文档 Bilingual | 本目录是 DSH + Obsidian 个人学习系统的可运行源码：通过 Obsidian Local REST API 插件受控读写 Vault，
> 驱动 karpathywiki（LLM Wiki）编译知识，并提供摄入/检索/练习三条业务流。
> This directory holds the runnable source of the DSH + Obsidian learning system: it reads/writes the vault through the
> Obsidian Local REST API plugin, drives karpathywiki (LLM Wiki) compilation, and provides ingest / search / practice flows.

## 依赖 / Requirements
- Obsidian 运行中，打开正式 Vault（learnEverything），启用插件：`obsidian-local-rest-api`（v5.5.2）与 `karpathywiki`（v1.28.0）
- API key：Obsidian → Settings → Local REST API → API key
- Node.js ≥ 20（本机 v24）

## 配置 / Configuration（code/.env）
```bash
cp .env.example .env   # 填 OBSIDIAN_API_KEY
```
| 变量 Env var | 含义 Meaning | 默认 Default |
|---|---|---|
| OBSIDIAN_API_KEY | 插件 API key（必填 required） | — |
| OBSIDIAN_BASE_URL | 插件 HTTPS 服务地址 | https://127.0.0.1:27124 |
| OBSIDIAN_SCOPE | 适配层限定目录（可选） | （空） |
| OBSIDIAN_INGEST_TIMEOUT_MS | 摄入后等待编译产物的最大毫秒数 | 900000（15min） |
| OBSIDIAN_INGEST_POLL_INTERVAL_MS | 轮询 wiki 产物的间隔毫秒数 | 10000 |
| OBSIDIAN_INGEST_SETTLE_MS | 首个产物出现后再等待的沉降毫秒数 | 60000 |
| OBSIDIAN_REVIEW_W_OVERDUE / WEAKNESS / COVERAGE / NOVELTY | 每日练习选题权重 | 1.0 / 0.8 / 0.5 / 0.3 |
| OBSIDIAN_STATE_DIR | 运行状态目录（注册表/作答/复习） | code/.state |

## 源码结构 / Source layout（按领域分包）
```
src/
├── obsidian/     # Vault 访问层：client（HTTPS+超时）、adapter（list/read/create/append/frontmatter/search）、
│                 #   vault-path（路径校验）、mcp-client（MCP JSON-RPC）
├── wiki/         # karpathywiki 驱动：open+ingest、快照 diff、阻塞等待（超时/轮询/settle 可配）
├── ingest/       # 摄入：source-fetch、preflight（查重）、planner、pipeline（两段确认+只 create）、registry、task-state
├── search/       # 检索：intent 分类、wiki-first retriever（停用词+分词回退、log/index 过滤）
└── learning/     # 学习：question-store、attempt-store（只追加）、review-scheduler（间隔递增+加权优先级）
scripts/          # ingest-cli / search-cli / practice-cli
tests/            # node --test 单测
```

## 使用 / Usage
```bash
# 摄入 /记住知识（URL 仅 https，或本地 Markdown；交互确认；--auto-yes 全自动）
node scripts/ingest-cli.mjs <https-url|local.md>

# 检索 /知识检索（意图路由：概念探索/原文溯源/结构查询/综合）
node scripts/search-cli.mjs "什么是间隔重复"

# 每日一练 /每日一练（选题优先级：到期复习>薄弱>覆盖>新颖；自评 1-5）
node scripts/practice-cli.mjs [题数]
```

## 自测 / Self-test
```bash
npm test                        # 单测 29/29（无网络）
OBSIDIAN_API_KEY=... npm run test:live   # 实时集成（连运行中的 Obsidian）
```

## 验收状态 / Acceptance（2026-10-23）
- **P1** MCP 接入 ✅：读写/搜索/同名 412 防覆盖/路径越界 400/.obsidian 403/Frontmatter 保留/404
- **P2** karpathywiki 验证 ✅：命令驱动摄入（免 UI）、wiki 产物可追溯、合并幂等、阻塞等待机制
- **P3** 摄入 ✅：预检查重 → 两段确认 → 只 create → 校验 → 编译 → 报告；端到端实测通过
- **P4** 检索 ✅：意图路由 + wiki-first + 证据摘录 + 元数据文件过滤
- **P5** 学习闭环 ✅：作答只追加、复习间隔幂次递增、到期优先
- 单测 29/29 + 实时集成 2/2 全绿；新增行为均有可回滚即失败的断言（AGENTS.md 硬规则）

## 快速命令自检（curl）
```bash
KEY=<你的key>; B=https://127.0.0.1:27124
curl -sk -H "Authorization: Bearer $KEY" $B/                      # 服务信息+认证状态
curl -sk -H "Authorization: Bearer $KEY" $B/vault/                # 列出 vault 文件
curl -sk -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: text/markdown" -H "If-None-Match: *" \
     --data-binary $'---\ntitle: x\n---\n\nbody' $B/vault/_t/a.md   # 创建（防覆盖 412）
curl -sk -G -X POST -H "Authorization: Bearer $KEY" --data-urlencode 'query=x' $B/search/simple/  # 搜索
```

## 说明 / Notes
- 密钥只存 .env（gitignored），不提交；运行状态（.state/）同样不入库
- karpathywiki 编译耗时 ~6min/源（LLM），CLI 会阻塞等待；超时/轮询/settle 可配置
- 涉及正式 Vault 的写操作都经过确认门禁；只 create、绝不静默覆盖人工笔记
