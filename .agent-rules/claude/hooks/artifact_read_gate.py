#!/usr/bin/env python3
"""PreToolUse hook for Read tool — blocks reads on artifact paths.

Fires BEFORE the Read tool executes. If the target path looks like a
subagent artifact (/tmp/*.md|txt|json or ~/.claude/artifacts/**), the
hook blocks the call and injects an intent-declaration prompt into the
model context, forcing the main agent to choose Transfer or Process
before the file content enters the context window.

Decision matrix:
  - artifact path detected  → block + inject intent prompt
  - non-artifact path       → approve (no-op)
  - any error               → approve (fail-open for latency)
"""

from __future__ import annotations

import json
import os
import sys


ARTIFACT_DIRS = [
    os.path.expanduser("~/.claude/artifacts/"),
    "/tmp/",
]

ARTIFACT_EXTENSIONS = {".md", ".txt", ".json", ".html", ".csv", ".yaml", ".yml"}

INTENT_PROMPT = (
    "ARTIFACT-READ-GATE: 你即将读取子代理 artifact 文件。\n"
    "必须先在本条消息中声明处理意图，再决定是否继续：\n"
    "  • 意图=「转交」（文档/报告/代码等最终产物，用户直接消费）"
    " → 禁止读取，直接告知用户文件路径。\n"
    "  • 意图=「加工」（需要主代理分析/对比/翻译/汇总）"
    " → 允许读取，请重新发起 Read 工具调用。\n"
    "  • 意图不明确 → 默认「转交」，询问用户是否需要进一步加工。\n"
    "本次 Read 已被阻止，请声明意图后再操作。"
)


def _is_artifact_path(path: str) -> bool:
    if not path:
        return False
    abs_path = os.path.realpath(os.path.expanduser(path))
    _, ext = os.path.splitext(path)
    for d in ARTIFACT_DIRS:
        abs_d = os.path.realpath(os.path.expanduser(d))
        if abs_path.startswith(abs_d) and ext.lower() in ARTIFACT_EXTENSIONS:
            return True
    return False


def main() -> int:
    try:
        raw = sys.stdin.read() or "{}"
        data = json.loads(raw)
        file_path = data.get("tool_input", {}).get("file_path", "")

        if _is_artifact_path(file_path):
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": INTENT_PROMPT,
                },
            }, ensure_ascii=False))
            return 0

        # Non-artifact: approve silently
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
        }}))
        return 0

    except Exception:
        # Fail-open: never block on hook errors
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
        }}))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
