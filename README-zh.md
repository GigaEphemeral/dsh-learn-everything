<p align="center">
  <a href="./README.md">English</a> | <a href="./README-zh.md">简体中文</a>
</p>

# DSH + Obsidian 学习系统 — DSH 插件（code/）

本目录是 DSH + Obsidian 个人学习系统的**完整 DSH 插件**：通过 Obsidian **Local REST API with MCP** 插件受控读写 Vault，
驱动 **karpathywiki**（LLM Wiki）编译知识，并提供摄入、检索、每日练习三条业务流。DSH 是唯一入口，
Obsidian 是正式知识资产的权威存储。

## 依赖
- Obsidian 运行中，打开正式 Vault（learnEverything），启用插件：`obsidian-local-rest-api`（v5.5.2）与 `karpathywiki`（v1.28.0）
- API key：Obsidian → 设置 → Local REST API → API key
- Node.js ≥ 22.6（本机 v24）
- DSH 0.2.1-rc2  web方式启动, 源码方式启动

## DSH 插件结构
```
package.json   # dsh.bundle.patch -> ./cordis.patch.yml
cordis.patch.yml  # 在 DSH profile 中注册本插件
index.js       # 把 skills/ 下的技能注册到 ctx.skills
skills/        # 内置技能：obs-remember-knowledge、obs-knowledge-search、obs-daily-practice、obs-access
```

## 源码结构（按领域分包）
```
src/
├── obsidian/     # Vault 访问层：client（HTTPS+超时）、adapter（list/read/create/append/frontmatter/search）、
│                 #   vault-path（路径校验）、mcp-client（MCP JSON-RPC）
├── wiki/         # karpathywiki 驱动：open+ingest、快照 diff、阻塞等待（超时/轮询/settle 可配）
├── ingest/       # 摄入：source-fetch、preflight（查重）、planner、pipeline（两段确认+只 create）、registry、task-state
├── search/       # 检索：intent 分类、wiki-first retriever（停用词剥离、分词回退、元数据文件过滤）
└── learning/     # 学习：question-store、attempt-store（只追加）、review-scheduler（间隔递增+加权优先级）
scripts/          # ingest-cli / search-cli / practice-db
tests/            # node --test 单测
```

## 知识资产与 Obsidian Vault 目录结构

obsidian Vault 为插件配置页面自配仓库, 自行配置。
按归属分割，DSH 写入不会污染人工维护或插件托管的内容：

| 目录 | 职责 | 归属 | 说明 |
|---|---|---|---|
| `Sources/` | **摄入原文存放处** —— 每次摄入的 URL/本地文件以 `<slug>.md` 落在这里（frontmatter：source_uri/source_id/content_hash/fetched_at + 原文正文） | DSH 写入、用户阅读 | 只 create、绝不覆盖 |
| `Inbox/` | 待处理材料 | 用户 | 空 |
| `wiki/` | karpathywiki **派生**知识网：`concepts/ entities/ sources/` + `index.md log.md schema/config.md` | 插件自动生成 | 可重建；不得视为原始知识 |

详细带截图的配置见:  

边界：`Sources/`＝正式知识（摄入原文）；`wiki/`＝派生可重建；**学习状态（Plans/Questions/Reviews：题目/作答/评分/复习调度/掌握度）存 SQLite，绝不写入 Vault 笔记**。

### 摄入流程（原文去向）
```
URL（仅 https）或本地 .md
  → 规范化（sha256 content_hash、source_id）
  → 预检（code/.state/sources.json 注册表精确查重 + wiki/sources 同 slug 相似查重）
  → 用户确认 ×2（范围、写入计划）
  → create-only 写入 → Sources/<slug>.md   ← 原文正文存于此
  → 读回校验
  → karpathywiki 编译 → wiki/ 派生页（source_file 可追溯）
  → 注册表记录（hash → vault 路径）
```

> 说明：REST API 只列出非空目录；空文件夹（Inbox）在磁盘存在但不出现在 `/vault/` 列表。

## 本地构建 / 打包 / 部署

```bash
npm ci --ignore-scripts          # 安装依赖（本机 npm cache 只读时：npm_config_cache=/tmp/npm-cache npm ci）
npm run build                    # tsc：src/db + src/learning -> lib/
npm run build:client             # esbuild：右侧栏面板 bundle -> lib/client.js
npm test                         # 314 测试，0 跳过
```

### 打包为完整包（发布用，非 link）
```bash
npm pack        # prepack 自动执行 build + build:client，产物 dsh-learn-everything-<version>.tgz
# 安装到 DSH（完整包安装，不依赖源码链接）
cd ~/sourceCodeDSH/deepseek-harness
dsh plugin --profile test add file:/home/czq/dsh-learn-everything/code/dsh-learn-everything-0.1.0.tgz
```

## 本地源码方式部署到dsh
```bash
# 1. 清理
## 0) 先停止 profile
## 1) 官方移除（等价于 pnpm remove：清理 node_modules 包 + lock + package.json 依赖）
cd ~/sourceCodeDSH/deepseek-harness
dsh plugin --profile test remove dsh-learn-everything

## 2) 兜底：若残留 rsync 目录副本，手动删
rm -rf ~/.dsh/profiles/test/node_modules/dsh-learn-everything

## 3) （可选）清掉 profile 配置里保存的插件设置（apiKey/baseUrl/vaultName）
##    编辑 ~/.dsh/profiles/test/cordis.patch.yml，删除 dsh-learn-everything 段
##    （不删也行：重新部署后这些设置仍在，保存过的配置会被再次读取）


# 2. 部署（源码形式，二选一）
## 方式 A —— 官方 file: 依赖安装（推荐正式部署）

cd ~/sourceCodeDSH/deepseek-harness
dsh plugin --profile test add file:/home/xxx/dsh-learn-everything/code
## 验证
ls ~/.dsh/profiles/test/node_modules/dsh-learn-everything/index.js

### 注意：pnpm 会把源码复制进 store再链接。之后每次改 code/ 都要重新 dsh plugin --profile test add file:...（或继续用 rsync）。

## 方式 B —— 源码实时链接（开发期最方便）
## 把 node_modules 里的包换成指向源码的符号链接：改 code/ 后只需重启 3081

rm -rf ~/.dsh/profiles/test/node_modules/dsh-learn-everything
ln -s /home/xxx/dsh-learn-everything/code ~/.dsh/profiles/test/node_modules/dsh-learn-everything
ls -ld ~/.dsh/profiles/test/node_modules/dsh-learn-everything   # 应显示 dsh-learn-everything -> /home/xxx/...

### 注意：下次跑 pnpm install 时 pnpm 可能重建自己的副本覆盖符号链接，需重做 ln -s。
```

## 配置（`code/.env`）
```bash
cp .env.example .env   # 可以到源码.env下
```
其他环境变量配置, 必填的项已可以在plugin配置页配置
| 变量 | 含义 | 默认值 |
|---|---|---|
| OBSIDIAN_API_KEY | 插件 API key（必填） | — |
| OBSIDIAN_BASE_URL | 插件 HTTPS 服务地址（必填）| https://127.0.0.1:27124 |
||||
| OBSIDIAN_SCOPE | 将适配层限定到 Vault 子目录（可选） | （空） |
| OBSIDIAN_INGEST_TIMEOUT_MS | 触发摄入后等待编译产物的最大毫秒数 | 900000（15 分钟） |
| OBSIDIAN_INGEST_POLL_INTERVAL_MS | 轮询 wiki 产物目录的间隔毫秒数 | 10000 |
| OBSIDIAN_INGEST_SETTLE_MS | 首个新页面出现后继续等待的沉降毫秒数 | 60000 |
| OBSIDIAN_REVIEW_W_OVERDUE / WEAKNESS / COVERAGE / NOVELTY | 每日练习选题权重 | 1.0 / 0.8 / 0.5 / 0.3 |
| OBSIDIAN_REVIEW_WEAKNESS_WINDOW | 薄弱度评分参考的近期作答数 | 3 |
| OBSIDIAN_LEARNING_DB | SQLite 学习数据库路径 | `<状态目录>/learning.db` |
| OBSIDIAN_WIKI_DIRS | 每日练习抽节点所使用的 wiki 目录（逗号分隔） | wiki/concepts,wiki/entities,wiki/sources |
| OBSIDIAN_STATE_DIR | 运行状态目录（摄入注册表、作答、复习） | code/.state |

### Obsidian 访问配置（S4 右侧栏面板）
- **plugins 页面**：DSH -> 插件 -> dsh-learn-everything -> apiKey（secret）+ baseUrl + vaultName；保存即生效（volatile 配置，无需重启；**保存前自动测试连接**，错 key 不保存）。
- **环境变量兜底**：OBSIDIAN_API_KEY / OBSIDIAN_BASE_URL / OBSIDIAN_VAULT_NAME（默认 https://127.0.0.1:27124 / learnEverything）。
- 优先级：插件配置 -> 环境变量 -> 默认；未配置时接口返回 503 obsidian-not-configured（而非 404）。
- 面板 = 客户端 half（src/client/index.js）在 DSH 原生右侧栏注册 Obsidian tab，数据经围栏路由（src/sidebar/routes.js）代理 Obsidian REST；API key 不进入浏览器。

## 说明
- 密钥只存 `.env`（gitignored）；运行状态（`.state/`）同样不入库
- karpathywiki 编译耗时约 6 分钟/源（LLM），CLI 会阻塞等待；超时/轮询/settle 均可配置
- 所有对正式 Vault 的写入都经过确认门禁；只 create，绝不静默覆盖人工笔记
