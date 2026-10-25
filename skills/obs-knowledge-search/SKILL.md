---
name: obs-knowledge-search
description: "检索 Obsidian 知识库：判断意图，Wiki 优先召回，原文核验，输出带真实路径与证据的答案。"
---

# /obs-knowledge-search：知识检索

只用原生工具，不要运行 shell 或自己发起 HTTP 请求。

## 检索
调用 \`obs_vault\`，action=\`search\`，query=\`<问题>\`。返回：
- \`intent\`：概念探索 / 原文溯源 / 结构查询 / 综合；
- \`sufficiency\`：supported / partial / none 及缺口；
- \`results\`：evidence（title / path / resultType / excerpt）。

需要看某个节点的完整正文时，再用 \`obs_vault\` action=\`node\`，name=\`<节点名>\`。

## 答案合成（带真实引用）
- 只基于返回的 evidence 组织答案，不凭空写结论。
- 每条关键结论附真实存在的路径引用（\`[[路径]]\` 或完整 vault 路径）；禁止编造路径或行号。
- 先看 sufficiency：\`supported\` 正常回答；\`partial\` 说明缺哪部分证据；
  \`none\` 明说知识库无此证据，不编造、不凭常识硬答（除非用户要求常识回答并标注）。
- 区分 Vault 证据与外部/常识信息；检索失败或超时如实报告，不返回虚构结果。
