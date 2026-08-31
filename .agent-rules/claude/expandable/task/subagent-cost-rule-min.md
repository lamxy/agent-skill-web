# 子代理成本控制极简规约

适用于代码开发场景下派发实现/审查/修复子代理，作为 `sub-agent-rule-min.md` 的专项补充。
通用输入约束、结果分流阈值、阻塞上报规则见 `sub-agent-rule-min.md`，本规约不重复。

## 输入构造（代码开发场景专项）

实现子代理只传：
1. 当前 Task 的完整文本（从计划文档中提取的单个 Task）
2. 已完成文件列表
3. 工作目录
4. 子代理极简规约摘要（2-4 行，至少包含：范围、阻塞上报、结果分流阈值）
5. 输出模板字段要求（强制按字段回传）

审查子代理只传：
1. Spec 要求（对应 Task 的设计约束，3-7 条）
2. 审查范围（文件路径列表）
3. 输出格式要求 + 子代理极简规约摘要（同上）

## 模型升级触发条件

| 子代理类型 | 默认 | 升级条件 |
|-----------|------|---------|
| 实现（1-2 文件，有明确 spec） | lite | BLOCKED 或涉及文件 >3 个 |
| Spec / 合规审查 | lite | 无需升级 |
| 代码质量审查 | lite | 发现 NEEDS_FIXES 时修复子代理升级为 standard |
| 修复 / 架构判断 | standard | — |

> lite / standard / powerful 由主代理按实际可用模型映射，不在规约中硬编码具体型号。

## 输出格式（代码开发专用）

实现子代理返回（不超过 10 行）：
```
STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
TESTS: X/X passed
COMMITTED: <SHA>
ARTIFACT: <复杂结果文件路径，如无则留空>
CONCERNS: <如无则留空>
```

审查子代理返回（不超过 5 行）：
```
RESULT: COMPLIANT/APPROVED | NON_COMPLIANT/NEEDS_FIXES
ARTIFACT: <复杂结果文件路径，如无则留空>
MISSING/ISSUES: <问题描述，如无则留空>
```

## 回传校验
回传不合规时的处置步骤（SendMessage 纠正 → 2 次仍不合规则降级），见 `sub-agent-rule-min.md`「回传校验」节。

## 避免
- 子代理接收整份计划文档作为输入
- 用高成本模型处理结构化对照类审查任务
- 子代理输出完整推理过程或原始日志
