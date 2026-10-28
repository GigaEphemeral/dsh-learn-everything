# dsh-learn-everything

> 收藏了，不等于学会了。运行在 DSH (DeepSeek Harness) 中的个人知识学习插件——把「知识管理」往前推一步，推向「主动学习」。

🏠 [项目主页](https://gigaephemeral.github.io/dsh-learn-everything/) · 📦 [GitHub](https://github.com/GigaEphemeral/dsh-learn-everything) · 📋 [Changelog](https://github.com/GigaEphemeral/dsh-learn-everything/blob/master/CHANGELOG.md)

## 这是什么

系统以 DSH 为唯一交互与任务入口，以 Obsidian 作为权威知识资产底座，通过 KarpathyWiki 作为知识编译与关联层，并利用 SQLite 独立管理学习状态，构建闭环的个人知识内化与训练体系。

**核心理念**：不追求功能堆砌，而是追求真实使用路径的可靠性、知识引用的可信度以及学习状态的可持续性。严格区分正式知识资产（Obsidian）、派生编译资产（KarpathyWiki）与过程性学习数据（SQLite），确保知识库不被过程数据污染。

## 三大核心能力

| 能力 | 命令 | 一句话说明 |
|---|---|---|
| 知识摄入 | `/obs-remember-knowledge` | 预检、查重、安全写入与编译驱动，把资料安全纳入知识体系 |
| 知识检索 | `/obs-knowledge-search` | 从自己积累的知识中找证据和引用，而不是重新搜索互联网 |
| 学习训练 | `/obs-daily-practice` | 即时出题、犀利评分、高压追问，SQLite 跟踪掌握度与复习排期 |

## Wiki 目录

- [[快速开始]] —— 依赖安装、Obsidian 配置、DSH 插件部署（带截图）
- [[知识摄入流程]] —— 预检 → 双确认 → create-only 写入 → wiki 编译
- [[检索与每日一练]] —— 证据检索 + 抽题/评分/追问/复习调度
- [[架构与数据边界]] —— 三类资产分层、安全门禁、源码结构
- [[配置参考]] —— 插件配置页与环境变量速查表

## 使用场景速览

摄入与练习的实际界面：

![摄入使用](https://github.com/GigaEphemeral/dsh-learn-everything/raw/master/detailDoc/screenshots/plugin/use-rember-2.png)
![练习使用](https://github.com/GigaEphemeral/dsh-learn-everything/raw/master/detailDoc/screenshots/plugin/use-pratice-1.png)

## 依赖

- Obsidian 运行中，打开正式 Vault（如 `learnEverything`），启用插件：`obsidian-local-rest-api`（v5.5.2）与 `karpathywiki`（v1.28.0）
- API key：Obsidian → 设置 → Local REST API → API key
- Node.js ≥ 22.6
- DSH 0.2.1-rc2（web 方式或源码方式启动）

## 开源

BSD-3-Clause · 欢迎 Star / Issue / PR · 一起开发，管理属于自己的学习软件。
