---
name: obs-daily-practice
description: "从知识库随机抽一个节点，LLM 即时出概念/实现/测试题，作答后犀利评分；低于 6 分强制进入 obs-grill-me 高压追问。用户想练习或检验掌握时使用。"
---

# /obs-daily-practice：每日一练

全程只调用本插件注册的原生工具。不要运行 shell 命令，也不要查找仓库、源码、目录结构或环境变量：
所需数据都由下面的工具一次返回。

## 流程
1. **抽节点**：调用 `practice_draw_node`（无参）。返回节点正文、来源路径与学习状态摘要。
2. **学习**：直接使用上一步的内容；内容不足时才用 `web_search` 或询问用户。
3. **出题**：从 概念题 / 实现题 / 测试题 中随机一种，基于该节点即时生成；题目不写入 Obsidian。
4. **提问**：用 `ask_user_question` 提问并等待作答。
5. **犀利评价**：按严苛教练标准给 0-10 分，指出 2-4 个具体错误或盲点，输出
   `{ score, correctness, key_mistakes, feedback, mastery_signal, follow_up_required }`；
   面向用户默认只给：分数 / 最关键错误 / 改进建议。
6. **记录**：出题后调用 `practice_record_question`；评价后调用 `practice_record_answer`
   （phase：首次 `first`，纠错 `correction`，变式 `variant`）。需要时用 `practice_status` 查看。
7. **强制追问**：首次评分低于 6，或用户表示不会时，必须调用 `practice_grill_gate`（score=本次评分）；
   当返回 required=true 时，必须加载并执行 `obs-grill-me` 技能，按该技能完成追问直到真正理解。
   这一步不是可选项：只做几轮本地轻量追问、或跳过 `obs-grill-me`，都不算完成本次练习。

## 纪律
- 题目与作答不写入 Obsidian；学习状态只存 SQLite（决策 B）。
- 评分必须具体、犀利、可执行，禁止含糊表扬。
- 联网搜索默认关闭，仅用户明确要求时使用。
- 工具报错时如实报告并停止，不要换其他方式硬试。
