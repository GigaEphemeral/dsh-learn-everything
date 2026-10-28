# Changelog

本项目所有值得注意的变更都记录在此文件。

格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- release workflow：Release 正文改用本文件（`body_path: CHANGELOG.md`）；新增 `Publish to npm` 步骤（`npm publish --provenance --access public`，需在仓库 Secrets 配置 Automation 类型的 `NPM_TOKEN`）
- npm 包内附 `CHANGELOG.md`

## [0.1.2] - 2026-10-28

### Fixed

- release workflow：`npm pack --pack-destination dist/` 前补 `mkdir -p dist`，修复 CI 打包步骤 exit 254

### Added

- GitHub Pages 项目主页（仓库根 `index.html` + `homepage-assets/`）
- 追问教学 `/obs-grill-me`：评分 < 6/10 强制进入高压追问，每轮一个关键问题，最多 8 轮，可配置 `grillPersona` 人格
- release workflow 加固：发布前跑 `npm test`、校验 tag 与 package.json 版本一致、显式 `build` + `build:client` 后打包到 `dist/`

### Changed

- 许可证统一为 BSD-3-Clause；移除 `package.json` 的 `private` 标记以允许 npm 发布

> 版本号说明：中间态 tag v0.1.1 因那次 CI 失败已撤回、未发布 Release，其 workflow 加固内容随 v0.1.2 一并生效。

## [0.1.0] - 2026-10-25

首个可安装包（GitHub Release 附 `dsh-learn-everything-0.1.0.tgz`，未发布到 npm）。

### Added

- 知识摄入 `/obs-remember-knowledge`：预检查重、两段确认门禁、create-only 安全写入 `Sources/`、读回校验、KarpathyWiki 编译派生 `wiki/`
- 证据检索 `/obs-knowledge-search`：wiki 优先检索、意图分类与分词回退、答案附来源路径
- 每日一练 `/obs-daily-practice`：从 wiki 节点即时抽题、SQLite 持久化掌握度与复习排期（答对间隔 ×2、答错重置 + 加权选题）
- DSH 右侧栏面板：Obsidian 图谱可视化与插件配置页（保存前自动测试连接）

[Unreleased]: https://github.com/GigaEphemeral/dsh-learn-everything/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/GigaEphemeral/dsh-learn-everything/releases/tag/v0.1.2
[0.1.0]: https://github.com/GigaEphemeral/dsh-learn-everything/releases/tag/v0.1.0
