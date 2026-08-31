# Multi-Agent Summary Template

用于主代理汇总多个子代理结果。

```text
[summary]
decision=<结论>
common=<共识>
conflict=<冲突点，如无则留空>
artifacts=<需要复核的结果文件路径列表；无则留空>
risk=<low|medium|high>
next=<下一步；如无则留空>
ask=<需要人工决策时填写，否则留空>
```

## 使用规则
- 先结论，再列共识和冲突。
- 重复信息只保留一次。
- 冲突必须显式化，不可模糊吞并。
- 不要逐条堆叠所有子代理原始输出。
