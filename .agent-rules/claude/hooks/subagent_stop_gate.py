#!/usr/bin/env python3
"""Minimal command hook for SubagentStop.

Behavior:
- Block when output exceeds size limits (>3000 total chars OR >150 lines).
  Rationale: oversized output must be saved to file and only a summary+path
  returned to the main agent. Field-format checking is intentionally removed
  to avoid conflicts with commands that use their own fixed output formats
  (e.g. /auditrules).
- Otherwise approve.

This is a size-only gate designed for low-latency, format-agnostic operation.

Size thresholds:
- TOTAL chars (len(raw)): primary gate, catches large content regardless of line count.
- Line count: secondary gate, raised to 150 to avoid false positives on structured
  but line-dense output (e.g. code listings, JSON arrays).
  50 lines was too aggressive — normal subagent responses routinely exceed it.

Note on SubagentStop block semantics:
  When this hook blocks, Claude injects the reason into the subagent's final
  message. The subagent has already stopped — it cannot execute new tool calls.
  The block feedback is returned as text to the main agent, which must not assume
  the subagent actually wrote a file. The main agent MUST verify file existence
  before treating an artifact path as valid (defense-in-depth, option C).
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime


SIZE_BLOCK_TOTAL_CHARS = 3000   # total content length (was: unique char set size — bug fix)
SIZE_BLOCK_LINE_COUNT = 150     # raised from 50; secondary gate only


def _debug_log(stdin_raw: str, output: dict) -> None:
    """Append a structured debug entry to file specified by SUBAGENT_STOP_DEBUG_LOG.

    Each entry contains a timestamp, the raw stdin received, and the JSON output emitted.
    No-op when the env var is unset or empty.
    """
    log_path = os.getenv("SUBAGENT_STOP_DEBUG_LOG", "")
    if not log_path:
        return
    try:
        ts = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        entry = (
            f"\n--- [{ts}] subagent_stop_gate ---\n"
            f"[stdin]\n{stdin_raw}\n"
            f"[output]\n{json.dumps(output, ensure_ascii=False)}\n"
        )
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(entry)
    except Exception:
        pass  # debug logging must never affect main flow


def _emit(payload: dict, stdin_raw: str = "") -> None:
    _debug_log(stdin_raw, payload)
    print(json.dumps(payload, ensure_ascii=True, separators=(",", ":")))


def _normalize_stdin_for_checks(raw: str) -> str:
    """SubagentStop stdin is typically JSON; fallback to raw text if parsing fails."""
    if not raw.strip():
        return ""
    try:
        payload = json.loads(raw)
    except Exception:
        return raw

    if isinstance(payload, dict):
        for key in ("last_assistant_message", "output", "result", "text", "content", "response", "message"):
            v = payload.get(key)
            if isinstance(v, str) and v.strip():
                return v
        return json.dumps(payload, ensure_ascii=False)
    if isinstance(payload, list):
        return json.dumps(payload, ensure_ascii=False)
    return str(payload)


def _exceeds_size_limit(raw: str) -> tuple[bool, int, int]:
    """Return (exceeded, total_chars, line_count)."""
    if not raw.strip():
        return False, 0, 0
    total_chars = len(raw)
    line_count = raw.count("\n") + 1
    exceeded = total_chars > SIZE_BLOCK_TOTAL_CHARS or line_count > SIZE_BLOCK_LINE_COUNT
    return exceeded, total_chars, line_count


def main() -> int:
    try:
        stdin_raw = sys.stdin.read() or ""
        raw = _normalize_stdin_for_checks(stdin_raw)

        # Size gate: block if output exceeds limits.
        # Subagent must save oversized content to a file and return only
        # a short summary + artifact path.
        # IMPORTANT: the subagent has already stopped when this hook fires.
        # The block reason is injected as text — the subagent cannot execute
        # new tool calls. The main agent must verify any reported file path exists.
        exceeded, total_chars, line_count = _exceeds_size_limit(raw)

        if exceeded:
            _emit({
                "decision": "block",
                "reason": (
                    f"Subagent output too large (total chars={total_chars}, lines={line_count}; "
                    f"limits: {SIZE_BLOCK_TOTAL_CHARS} chars, {SIZE_BLOCK_LINE_COUNT} lines). "
                    "WARNING: you have already stopped — you cannot write files now. "
                    "MAIN AGENT INSTRUCTIONS: do NOT display this raw output to the user. "
                    "Re-invoke this subagent with explicit instruction: "
                    "(1) write the full content to a file (suggest a path under /tmp or the project dir), "
                    "(2) return only a short summary (<=10 lines) + the absolute artifact path, "
                    "(3) the main agent then decides whether to read the file, show the path to the user, or take other action."
                ),
            }, stdin_raw)
            return 0

        _emit({"decision": "approve"}, stdin_raw)
        return 0
    except Exception:
        # Fail-open for latency and robustness
        _emit({"decision": "approve"})
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
