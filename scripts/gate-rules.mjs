// Pure decision rules for the approval gate (no I/O), unit-tested.
export function decide(cmd, env = process.env) {
  if (typeof cmd !== "string" || !cmd) return null;
  const publishes = /\bgit\s+(?:-\S+\s+)*(?:commit|tag)\b|\bgh\s+pr\s+(?:create|edit)\b/.test(cmd);
  const signature = /Co-Authored-By:|Claude-Session:|claude\.ai\/code\/session|Generated with \[?Claude Code/i.test(cmd);
  if (publishes && signature && env.PMS_ALLOW_TRAILERS !== "1")
    return { decision: "deny", rule: "no-trailers",
      reason: "Blocked by persistent-memory approval gate: no Co-Authored-By, session link or tool signature in commits/PRs unless the user explicitly asked for it. Remove it, or ask the user first." };
  if (/\bgit\s+(?:-\S+\s+)*push\b[^|;&\n]*\s(?:--force(?:-with-lease)?(?:=\S+)?|-f)(?:\s|$)/.test(cmd))
    return { decision: "ask", rule: "force-push",
      reason: "Force push rewrites published history. It needs the user's explicit approval." };
  return null;
}
