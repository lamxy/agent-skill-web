# Tool Result Summary Template

用于工具调用后的最小摘要输出。

```text
[tool-summary]
result=<结论>
evidence=<关键证据>
risk=<low|medium|high>
next=<下一步；如无则留空>
```

## 使用规则
- 只保留与当前决策直接相关的信息。
- 不粘贴完整工具原始输出。
- 若多个工具结果重复，合并成一个摘要。
- 若结果冲突，优先指出冲突及其影响。
