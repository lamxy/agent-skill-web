# Audit Report Template

用于主代理保存审计结果到 Markdown 文档。

```text
# Audit Report

- Task: <任务摘要>
- Generated At: <yyyy-mm-dd hh:mm:ss>
- Result: <通过|有问题>
- Report Path: <当前 markdown 路径>

## Audit Input Summary

- Loaded Rules: <已加载规约列表>
- Loaded Templates: <已加载模板列表>
- Task Type: <任务类型>
- Tools Used: <工具数量或简述>
- Subagents Used: <是/否 + 数量>
- Periodic Task: <是/否>
- Output Size: <短/中/长>
- Scope Risk: <是否存在超预算、阻塞子代理或 hook 噪音>

## Audit Result

- Findings: <问题项；若无则写“无”>
- Recommendation: <最关键的一条改进；若无则写“无”>

## Next Step

- <主代理下一步动作>
```

使用规则：
- 模板保持极简，优先可追溯，不扩写成长报告。
- 若审计结果为“通过”，`Findings` 与 `Recommendation` 可写“无”。
- 主代理保存后，仍需在回传中明确上报文档路径。