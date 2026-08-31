# 派发模板使用规则

> **每次派发子代理时，必须在 prompt 末尾追加 `dispatch-footer.md` 的输出约束内容。**
> 路径：`expandable/templates/dispatch-footer.md`

## 判断规则（决策树）

- 第一步：是否满足派发闸门？（见 `sub-agent-rule-min.md`「派发闸门」）
	- 不满足 → 主代理直接执行，不派发
	- 满足 → 进入第二步
- 第二步：派发复杂度
	- 极简（cmd ≤ 1 条，无依赖，无多步骤）→ 自由组织，无需模板
	- 标准（cmd 2-5 条，有明确上下文，单层依赖）→ 使用"标准派发"
	- 复杂（多步骤、多层依赖、需传大量上下文）→ 使用"完整派发"
- 第三步：上下文预算
	- token 紧张或高频重复场景 → 在当前复杂度档位基础上降一级（完整→标准，标准→极简）
- 多子代理或代理团队场景：除 `output_format` 外，必须同时提供 `summary_format`

## 场景字段差异

三种场景的派发框架相同，仅以下字段不同：

| 场景 | output_format 标签 | summary_format 标签 | 额外字段 |
|------|-------------------|--------------------|---------| 
| 单子代理 | `[agent]` | 不需要 | — |
| 多子代理 | `[agent]` | `[summary]` | — |
| 代理团队 | `[team-agent]` | `[team-summary]` | `progress` |

字段清单：
- `[agent]` / `[team-agent]`：`role, state, delta, evidence, artifact, risk, next, ask`
- `[summary]`：`decision, common, conflict, artifacts, risk, next, ask`
- `[team-summary]`：`decision, progress, common, conflict, artifacts, risk, next, ask`

## 最小合规检查清单（5 项）
- 已明确范围：`task` 与 `context` 不含超范围要求。
- 已附带规约：`contract` 已提供子代理极简规约摘要（范围、阻塞上报、结果分流、禁止嵌套）。
- 已明确输出：`output_format`（多代理时含 `summary_format`）字段齐全。
- 已明确异常：包含"审批即时上报 + 阻塞 20-30 分钟上报"规则。
- 已明确分流：包含"简单直返 + 复杂落盘并回传 artifact"规则。

## 一致性与冲突处理
- `output_format` 和 `summary_format` 的字段名应与对应模板保持一致。
- `contract` 必须给出子代理极简规约摘要，且与 `output_format` 字段一致，不可冲突。
- 若本文件示例与 task 规约冲突，以 task 规约为准。
- `ask` 字段仅在需要确认时填写，且一次只问一个最小问题。

## 完整派发示例

适用于多步骤、多层依赖、需传大量上下文的复杂场景。

### 单子代理
```text
[dispatch]
task=请独立完成当前任务并返回最小结果
cmd=仅使用给定输入范围，不扩展目标
cmd=简单结果（≤150行且≤3000字符）直接返回；复杂结果先落盘再回传摘要与artifact
cmd=遇到权限或审批限制立即上报并等待
cmd=阻塞超过20-30分钟时返回已完成证据并标记partial或blocked
cmd=禁止嵌套派发子代理；需拆分时通过ask上报
context=输入文件: <file_a>, <file_b>
contract=仅处理指定范围；禁止长背景复述；按[agent]字段回传；需要确认时仅填写ask；禁止嵌套派发
output_format=
[agent] role=<sub-agent>
state=<success|partial|failed|blocked>
delta=<本次新增结果>
evidence=<关键证据>
artifact=<复杂结果文件路径；无则留空>
risk=<low|medium|high>
next=<下一步建议；如无则留空>
ask=<需要确认时填写，否则留空>
```

### 多子代理（仅额外部分）
与单子代理相同，增加 `summary_format`：
```text
summary_format=
[summary]
decision=<最终结论>
common=<多子代理共识>
conflict=<冲突点，如无则留空>
artifacts=<需复核文件路径列表；无则留空>
risk=<low|medium|high>
next=<下一步；如无则留空>
ask=<需要人工决策时填写，否则留空>
```

### 代理团队（仅额外部分）
output_format 改用 `[team-agent]`，summary_format 改用 `[team-summary]` 并增加 `progress` 字段：
```text
output_format=
[team-agent] role=<agent role>
state=<success|partial|failed|blocked>
delta=<本次新增结果>
evidence=<关键证据>
artifact=<复杂结果文件路径；无则留空>
risk=<low|medium|high>
next=<建议下一步；无则留空>
ask=<需要leader确认时填写，否则留空>

summary_format=
[team-summary]
decision=<团队结论>
progress=<当前阶段>
common=<团队共识>
conflict=<冲突点，如无则留空>
artifacts=<需复核文件路径列表；无则留空>
risk=<low|medium|high>
next=<下一步；如无则留空>
ask=<需要人工确认时填写，否则留空>
```

## 标准派发示例

适用于 2-5 条 cmd、有明确上下文、单层依赖的常见场景。

```text
[dispatch]
task=<任务描述，1行>
cmd=<具体命令/步骤，每条一行，2-5条>
context=<依赖文件或前置条件>
contract=仅处理指定范围；按[agent]字段回传；简单直返，复杂落盘；审批即时上报；阻塞20-30分钟上报；禁止嵌套
output_format=[agent] role/state/delta/evidence/artifact/risk/next/ask
summary_format=<多代理时填写，单代理留空>
```

## 极简派发示例

适用于 token 紧张、高频重复或快速协作场景。cmd ≤ 1 条时可自由组织，以下为参考格式：

```text
[dispatch]
task=<任务>
cmd=<指令；简单直返，复杂落盘；审批/阻塞即时上报；禁止嵌套>
context=<文件列表>
contract=按[agent]字段回传
output_format=[agent] state/delta/evidence/artifact/risk/next/ask
```

## 子代理错误上报压缩规则
- 错误超过5行 → 只保留：错误类型 + 第一条关键行 + 影响范围
- 多个同类错误 → 合并为一条，注明数量
- 原始 traceback 禁止回灌主会话，只提取 error_type + message
- 压缩后格式：error=<type>: <message>  scope=<影响范围>
