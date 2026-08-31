# Team Leader Output Template

用于 team leader 向主线程或用户输出团队级结果。

```text
[team-summary]
decision=<结论>
progress=<当前进度或阶段>
common=<团队共识>
conflict=<冲突点，如无则留空>
artifacts=<需要复核的结果文件路径列表；无则留空>
risk=<low|medium|high>
next=<下一步；如无则留空>
ask=<需要人工确认时填写，否则留空>
```

使用规则：
- 先给团队结论，再给状态与冲突。
- 不逐条罗列所有 team agent 原始输出。
- 无新增变化时，progress 和 common 仅保留最小更新。
- 仅在需要人工介入时填写 ask。
