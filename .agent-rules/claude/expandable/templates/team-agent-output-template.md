# Team Agent Output Template

用于 team agent 向 team leader 返回局部结果。

```text
[team-agent] role=<agent role>
state=<success|partial|failed|blocked>
delta=<本次新增结果>
evidence=<关键证据>
artifact=<复杂结果文件路径；无则留空>
risk=<low|medium|high>
next=<建议下一步；无则留空>
ask=<需要 leader 确认时填写，否则留空>
```

使用规则：
- 仅返回局部职责范围内的结果。
- 不重复团队背景。
- 不转述其他成员完整结果。
- 简单结果直接回传；复杂结果落盘并通过 artifact 返回文件位置。
- 不返回长日志、长历史、完整推理。
