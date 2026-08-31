# PostToolUse Hook 陷阱分析与优化指南

- Generated At: 2026-04-28
- Status: 已验证（基于真实对话中断事件）

---

## 事件背景

被移除的 PostToolUse hook 配置：

```json
"PostToolUse": [{
  "matcher": "*",
  "hooks": [{
    "type": "prompt",
    "timeout": 15,
    "prompt": "You are a non-blocking noise triage hook. Never block. Detect only high-confidence non-blocking noise patterns such as PostToolUse evaluator warnings, plugin log-write failures, or missing remember directory. If detected, return JSON exactly: {\"systemMessage\":\"[noise-info] Non-blocking hook/plugin noise detected; continue main flow.\"}. If not detected, return JSON exactly: {}."
  }]
}]
```

设计意图：无害的噪音分类，永不 block。  
实际效果：每次工具调用后触发 `stopped continuation`，中断执行链。

---

## 根本原因

问题不在 hook 的判断逻辑，而在于 **`PostToolUse` + `prompt` 类型的执行机制本身**。

`prompt` 类型 hook 会在执行链中间发起一次模型调用。Claude Code 引擎在处理这个中间模型调用时，会将其结果作为一个 continuation event。当该 event 注入执行链后，引擎有时误判为"子流程已结束"，触发 `stopped continuation`，中断后续执行。

即使 hook 永远返回 `{}`（空对象），这个问题依然存在。

---

## 各 Hook 位置风险对比

| Hook 位置 | prompt hook 调用时机 | stopped continuation 风险 |
|-----------|---------------------|--------------------------|
| `PreToolUse` | 工具执行前，主流程暂停等待 | 低 |
| **`PostToolUse`** | **工具返回后、assistant 生成前** | **高** |
| `Stop` | assistant 停止输出后 | 低 |
| `SubagentStop` | 子代理停止后 | 低 |
| `PreCompact` | 压缩前 | 低 |

---

## 核心结论

> **`PostToolUse` 位置不应使用 `prompt` 类型 hook。**  
> 无论判断逻辑多保守，模型调用本身就会在执行链中间制造 `stopped continuation` 风险。

---

## Hook 类型选择原则

| 需求 | 推荐位置 | 推荐类型 |
|------|---------|---------|
| 噪音检测/日志分类（非阻塞） | `PostToolUse` | `command`（非模型调用） |
| 完成性门禁 | `Stop` | `prompt` |
| 子代理输出格式校验 | `SubagentStop` | `prompt` |
| 高风险命令拦截 | `PreToolUse` | `prompt` |
| 压缩前关键事实保全 | `PreCompact` | `prompt` |

---

## PostToolUse 的正确用法

若确实需要工具调用后处理，使用 `command` 类型：

```json
"PostToolUse": [{
  "matcher": "*",
  "hooks": [{
    "type": "command",
    "command": "echo '[noise-triage] tool completed' >> /tmp/claude-hook.log"
  }]
}]
```

`command` 类型不调用模型，不产生 continuation 歧义。

---

## 未来配置 PostToolUse 的规则

1. 只用 `command` 类型，不用 `prompt` 类型
2. 命令必须是非阻塞的（快速退出）
3. 不依赖 systemMessage 影响主流程（注入点不稳定）
4. timeout 设为最小值
5. 测试时观察是否出现 `stopped continuation`，出现即移除

---

## 当前推荐最小配置

```
PreToolUse   → Bash 安全语义审查（prompt）
Stop         → 完成性门禁（prompt）
SubagentStop → 子代理格式门禁（prompt）
PreCompact   → 关键事实保全（prompt）
```

无 PostToolUse，低噪音，执行链稳定。
