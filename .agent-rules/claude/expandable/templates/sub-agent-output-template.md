# Sub-Agent Output Template

用于单个子代理执行局部任务后的标准输出。

```text
[agent] role=<sub-agent>
state=<success|partial|failed|blocked>
delta=<本次新增结果，尽量短>
evidence=<关键证据>
artifact=<复杂结果文件路径；无则留空>
risk=<low|medium|high>
next=<下一步建议；无则留空>
ask=<需要主代理确认时填写，否则留空>
```

## 使用规则
- 子代理只输出其职责范围内的信息。
- 不重复主代理已知背景。
- 不输出完整推理、完整日志、完整历史。
- 简单结果直接写在 delta/evidence；复杂结果写入文件并在 artifact 提供路径。
- 输出应尽量短且结构稳定。
