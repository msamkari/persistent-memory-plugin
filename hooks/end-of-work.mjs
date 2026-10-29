// Stop hook, opt-in per project: blocks ending a turn ONCE when this session wrote work files
// and the project's state files (HANDOVER, manifest, ...) were not updated afterwards.
// Silent no-op unless the project has MDs/freshness.json (see scripts/freshness.mjs and docs/end-of-work.md).
// Never blocks twice (stop_hook_active), skips scheduled-task runs, and fails open on any error or bound.
// Reads only file times and the session transcript; writes nothing; no network.
import { loadConfig, staleReport, sessionStartMs, isScheduledTask, writtenByThisSession } from "../scripts/freshness.mjs";

const allow = () => process.exit(0);
const TIMEOUT = setTimeout(allow, 12000); // hard stop: fail open (hook timeout is 15 s)
TIMEOUT.unref?.();
try {
  let raw = ""; for await (const c of process.stdin) raw += c;
  const input = JSON.parse(raw || "{}");
  if (input.stop_hook_active) allow();                       // second pass: never loop
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const cfg = loadConfig(root);
  if (!cfg || cfg.disabled) allow();                         // project did not opt in, or switched it off
  const tp = input.transcript_path || "";
  if (!tp || isScheduledTask(tp)) allow();                   // scheduled runs are never stopped
  const rep = staleReport(root, cfg, sessionStartMs(tp));
  if (!rep || rep.newer.length === 0) allow();
  const mine = await writtenByThisSession(tp, rep.newer.map((n) => n.rel));
  const list = rep.newer.filter((n) => mine.has(n.rel));
  if (list.length === 0) allow();                            // changed by another session, agent or sync: not this one
  const names = list.slice(0, 6).map((n) => n.rel).join(", ");
  const reason = `Project state files are behind: this session wrote work files (${names}) after the last update of ${rep.oldestRel}. `
    + `Before ending, update ${cfg.state.join(" and ")} (the work log first, the hand-over file last), then confirm to the user that the project files are current.`
    + (cfg.reasonExtra ? " " + cfg.reasonExtra : "");
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
} catch { allow(); }
