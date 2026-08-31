# 代理团队（Agent Team）极简规约

适用于 team leader 协调多个 team agent 持续协作的场景。

## 场景边界

单实例可独立完成时，可不扩展团队协作。

角色：
- team leader：负责拆解、分配、节流、汇总、裁决、对外输出
- team agent：负责执行被分配的局部任务，只返回最小必要结果

规则：
- 先分工，再执行，再汇总，再决策。
- team leader 仅向每个 team agent 提供最小必要上下文。
- team agent 仅回传局部结果、关键证据、风险与下一步；不重复团队背景，不转述其他成员完整输出。
- 结果分流：简单结果（不超过 150 行且总字符 ≤3000）直接回传；复杂结果（超出任一阈值）先落盘至 `.claude/artifacts/`，再回传摘要与文件位置。
- team agent 遇到工具权限、审批或访问受限时立即上报并等待确认；长时间工具阻塞时优先回传已完成证据与当前状态，不得静默挂起。
- team leader 不把所有成员原始输出堆回主线程。
- 团队共享信息只保留最小必要公共上下文。
- 多成员结果先去重，再合并；冲突显式标记。
- team leader 对外只输出：结论、共识、冲突、风险、下一步。
- 若团队处于长周期协作中，只汇报新增变化，不回灌完整历史。
- team agent 实例阻塞达到 20-30 分钟时，team leader 应快速评估中断、替换快速评估实例或请求用户审批，并基于已完成证据继续主流程。

## 回传校验
team agent 回传不合规时的处置步骤（SendMessage 纠正 → 2 次仍不合规则降级），见 `sub-agent-rule-min.md`「回传校验」节。

避免：
- 多成员重复做同一件事
- 成员之间转发完整历史

## 输出格式
- team leader 对外汇总：参见 `expandable/templates/team-leader-output-template.md`
- team agent 向 leader 上报：参见 `expandable/templates/team-agent-output-template.md`
