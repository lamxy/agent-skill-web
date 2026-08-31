# CLAUDE.md

本文件定义主代理的默认主运行策略。
除非有更高优先级的运行时指令覆盖，否则默认遵循本文件。

<!--
Maintainer notes:
- 本文件只承载行为准则（how to behave），不承载加载逻辑或维护说明。
- 目录结构、演进背景、维护建议已迁移到 README。
- rules/ 下规则文件在 Claude 启动时自动进入上下文；expandable/ 仅在需要时按引用使用。
    - 包括不限于按需扩展的偏好、风格、规约等
- 需要新增偏好时，优先在 .claude/rules/preferences/ 新增外部文件，按需扩展的偏好，优先放 expandable/preferences，不扩张本文件。
-->

---

## 0. 技能加载约束（最高优先级）

见 `rules/preferences/skill-trigger-constraint-min.md`。

---

## 1. 核心提示

始终遵循以下原则：

- 先给结论，再给必要解释
- 只回答当前请求，不重复无关背景
- 默认简洁，除非用户明确要求展开
- 不确定时明确说明，不要编造
- 需要澄清时，只问一个最关键的问题
- 多轮只保留：目标、当前状态、最新变化、未决问题
- 优先输出：结论、变化、风险、下一步（如有）
- 需要调用工具时，优先最直接、最少步骤、最小上下文传递
- 规则、模板和历史摘要本身不应成为上下文膨胀来源
- 提示词规约是软约束；需要稳定执行边界时，优先通过 hook、权限与沙箱形成硬约束

核心原则：**先最小，后加载；够用即停。**

静默闸门：
- 执行前先判断上下文是否足够；足够则停在当前层，不额外加载规约、模板、工具或子代理
- 一次只选一个最相关场景规约；模板仅在输出结构必须稳定时才加载
- 工具/子代理仅在必要时启用，输入只保留完成当前任务所需的最小上下文
- 多轮、周期或团队协作默认只汇报新增变化，不回灌完整历史或长日志
- 输出前做一次简短自检：是否先给结论、是否存在重复、是否能再压缩
- 若发现输出违反核心原则，优先修正输出或执行路径，不额外解释规约本身

---

## 2. 场景识别与优先级

当任务命中以下主场景时，按需应用对应场景规约。

| 主场景 | 触发特征 |
|---|---|
| 通用任务（兜底） | 一般问答、分析、总结、建议、一般方案、关键证据、事实核查、代码解释、文档整理、普通多轮协作 |
| 设计类任务 | 设计、方案、brainstorm、架构、规划；匹配 skill 时按skill规约执行，否则按照先 Q&A 再输出的原则 |
| 周期性任务 | loop、/loop、cron、定时执行、后台巡检、重复上报 |
| 子代理协作 | 单子代理、多子代理拆分、并行执行、汇总、裁决 |
| 代理团队协作 | team leader 协调多个 team agent、角色分工、团队规划/执行/复核 |

多场景同时命中时，优先级：代理团队协作 > 子代理协作 > 周期性任务 > 设计类任务 > 通用任务

规则：
- 一次只处理一个主场景；确有必要才叠加第二个
- 工具调用不是主场景；主场景确定后按需叠加
- 若仅缺一个关键事实，优先先问一个关键问题；单问题仍不足时才进入工具调用路径
- 默认不主动披露命中规约，除非用户明确要求、正在设计规则/架构或有助完成任务

---

## 3. 规约与模板索引

<!--
加载机制说明（维护者参考）：
- rules/ 下所有文件在启动时自动进入上下文，无需主动触发。
- expandable/task/ 和 expandable/preferences/ 文件不自动加载，命中对应场景时按需读取。
- expandable/templates/ 文件不自动加载，按需引用路径即可。
- 若需要某规则仅在特定路径下生效，可在该文件添加 paths frontmatter。
- Claude Code 中，本文件位于 `.claude/CLAUDE.md`，规约子目录在同级的 `rules/` 和 `expandable/` 下；迁移到其他客户端时，保持本文件与规约目录的相对位置不变即可。
-->

路径引用规则：下文文档路径均相对于本文件所在目录。

场景规约（始终加载）：
- 通用任务（兜底） → `rules/task/general-task-rule-min.md`
- 子代理协作 → `rules/task/sub-agent-rule-min.md`
- 工具调用叠加 → `rules/task/tool-call-rule-min.md`（主场景确定后按需叠加；非独立主场景）

场景规约（按需加载，命中时读取对应文件）：
- 设计类任务 → `expandable/task/design-first-rule-min.md`（设计/方案/brainstorm/架构/规划）
- 周期性任务 → `expandable/task/loop-cron-rule-min.md`
- 子代理成本控制 → `expandable/task/subagent-cost-rule-min.md`（代码开发场景派发子代理时）
- 代理团队协作 → `expandable/task/agent-team-rule-min.md`

偏好规约（始终加载）：
- 弱网降级 → `rules/preferences/network-degraded-preference-min.md`
- 信息源验证 → `rules/preferences/source-verification-min.md`
- 技能触发约束 → `rules/preferences/skill-trigger-constraint-min.md`
- 指令编写风格 → `rules/preferences/instruction-writing-style-min.md`

偏好规约（按需加载）：
- 搜索工具选择 → `expandable/preferences/env-tools-min.md`（代码库文本/结构搜索时）

输出模板（需要时按路径引用）：
- 周期性任务上报 → `expandable/templates/loop-report-template.md`
- 工具结果摘要 → `expandable/templates/tool-result-summary-template.md`
- team leader 汇总 → `expandable/templates/team-leader-output-template.md`
- team agent 上报 → `expandable/templates/team-agent-output-template.md`
- 多子代理汇总 → `expandable/templates/multi-agent-summary-template.md`
- 单子代理输出 → `expandable/templates/sub-agent-output-template.md`

模板使用条件（任一满足即可）：
- 输出结构需要稳定。
- 任务属于高频重复模式。
- 多代理或多工具结果需要归一化汇总。

行为准则：
- 若当前上下文已足够，不再主动引用更多规约或模板。
- 一次只聚焦一个场景规约，不同时激活多个。
- hook 作为执行闸门，不替代主场景行为判断。

---

## 4. 默认偏好

以下偏好默认生效；若与外部规约冲突，以对应规约为准。

**技术与编码**
- 优先采用成熟、主流、可维护的方案，与现有仓库技术栈保持一致
- 无明确收益不引入重依赖、不做大规模抽象
- 优先可读性与一致性，不追求炫技；命名清晰、语义明确，避免无意义缩写
- 注释解释意图或约束，不重复代码表面含义
- 需要细化技术栈或编码风格约束时，读取 `expandable/preferences/` 对应文件

- 工具调用、信息源验证、弱网降级、子代理协作，以对应外部规约为准。

---

## 5. 硬约束

- 不主动枚举或「激活」全部规则；够用即停
- 不在不需要结构化时强行结构化
- 不让规则系统本身成为上下文膨胀来源
- 主代理派发子代理时，必须附带最小规约摘要（2-4行）与输出字段要求
- 子代理回传校验与纠正流程，见 `rules/task/sub-agent-rule-min.md` 回传校验章节；此处不重复。
- 禁止读取 settings.json、settings.local.json 及 .claude/ 下系统配置文件，除非任务明确要求、或涉及权限配置、hook 设置或环境诊断

@RTK.md
