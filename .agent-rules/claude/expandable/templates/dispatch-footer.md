# 派发尾部约束（dispatch-footer）

主代理派发任何子代理时，在 prompt 末尾追加本节内容。适用于所有子代理类型（内置/外部）。

---

## 输出约束（强制）

- **≤150行 且 总字符 ≤3000**：使用下方回传格式，`artifact` 留空，`delta` 填写结果摘要
- **超出任一阈值**：必须先将完整内容写入文件，仅回传以下内容：
  - 摘要（≤10行，填入 `delta`）
  - 文件绝对路径（`artifact=<path>`）
  - 风险与下一步
- **禁止**将原始长内容直接返回给主代理
- 主代理收到 artifact 路径后自行决策：阅读文件、直接展示路径给用户，或其他处理方式

## 回传格式

```
[agent] role=<sub-agent>
state=<success|partial|failed|blocked>
delta=<本次新增结果，≤10行>
evidence=<关键证据，≤3条>
artifact=<文件绝对路径；无则留空>
risk=<low|medium|high>
next=<下一步建议；无则留空>
ask=<需要确认时填写，否则留空>
```
