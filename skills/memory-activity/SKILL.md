---
name: memory-activity
description: Show or append to the append-only activity log (Activity_Log/activity.jsonl) in the local memory folder: what was done, when, and under which approval. Use when the user says "activity log", "audit log", "what did you do and who approved it", "سجل النشاط". Not part of the mandatory session read.
disable-model-invocation: true
allowed-tools: Bash(node:*)
---
The activity log is for audit only. It is append-only: never edit or delete lines.

- Show recent entries: `node "${CLAUDE_PLUGIN_ROOT}/scripts/activity.mjs" tail 20`
- Record an action the user approved: `node "${CLAUDE_PLUGIN_ROOT}/scripts/activity.mjs" add "<action>" "<detail>" "<approval, quoting the user's words>"`

Record only what the user actually said as the approval; if none, write "none stated". Do not paste secrets or file contents into the log. The approval-gate hook also writes its own deny/ask decisions here.
