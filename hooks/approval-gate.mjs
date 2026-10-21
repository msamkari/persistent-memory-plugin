// PreToolUse(Bash) approval gate. Reads the tool call from stdin; makes NO network calls.
// 1) git commit/tag or gh pr create/edit whose text carries a Co-Authored-By / Claude-Session /
//    session link / "Generated with Claude Code" signature -> DENY, unless the user explicitly asked
//    for it and set PMS_ALLOW_TRAILERS=1.
// 2) git push with --force / --force-with-lease / -f -> ASK (the user must approve it explicitly).
// Gate decisions are appended to Activity_Log/activity.jsonl when the memory folder is set.
import { appendActivity } from "../scripts/activity.mjs";
import { decide } from "../scripts/gate-rules.mjs";

const dir = process.env.CLAUDE_PLUGIN_OPTION_MEMORY_DIR || process.env.PMS_MEMORY_DIR || "";
try {
  let raw = ""; for await (const c of process.stdin) raw += c;
  const input = JSON.parse(raw || "{}");
  const d = decide(input?.tool_input?.command);
  if (d) {
    try { appendActivity(dir, { source: "approval-gate", action: d.rule, detail: d.decision, approval: "n/a" }); } catch {}
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: d.decision, permissionDecisionReason: d.reason } }));
  }
} catch { /* fail open on parse errors: this gate is advisory, never blocks normal work */ }
process.exit(0);
