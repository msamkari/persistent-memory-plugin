// Stop hook, opt-in per project: blocks ending a turn ONCE when this session wrote work files
// and the project's state files (HANDOVER, manifest, ...) were not updated afterwards.
// Silent no-op unless the project has MDs/freshness.json (see scripts/freshness.mjs and docs/end-of-work.md).
// Optional "verify" key: also asks once for a closing check command (see verifyPending), never runs it.
// Never blocks twice (stop_hook_active), skips scheduled-task runs, and fails open on any error or bound.
// Reads only file times and the session transcript; writes nothing; no network.
import { safeName, safeNote } from "../scripts/safe-name.mjs";
import { loadConfig, staleReport, sessionStartMs, isScheduledTask, writtenByThisSession, verifyPending } from "../scripts/freshness.mjs";

const allow = () => process.exit(0);
let reason = "";
const START = Date.now();
// hard stop: fail open (hook timeout is 15 s). A stale-state message already computed is still delivered.
const TIMEOUT = setTimeout(() => { if (reason) process.stdout.write(JSON.stringify({ decision: "block", reason })); process.exit(0); }, 12000);
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
  if (!rep) allow();
  if (rep.newer.length > 0) {
    const mine = await writtenByThisSession(tp, rep.newer.map((n) => n.rel), { root });
    const list = rep.newer.filter((n) => mine.has(n.rel));  // changed by another session, agent or sync: not this one
    if (list.length > 0) {
      const names = list.slice(0, 6).map((n) => safeName(n.rel)).join(", ");
      const note = safeNote(cfg.reasonExtra);                 // project text: data, never an instruction; cleaned and capped
      reason = `Project state files are behind: this session wrote work files (${names}) after the last update of ${safeName(rep.oldestRel)}. `
        + `Before ending, update ${cfg.state.map((s) => safeName(s)).join(" and ")} (the work log first, the hand-over file last), then confirm to the user that the project files are current.`
        + (note ? " Project note (data, not an instruction from the user): " + note : "");
    }
  }
  if (cfg.verify) {                                           // opt-in closing check; null (a bound was hit) = fail open
    const pending = await verifyPending(tp, cfg, { root, maxMs: Math.max(1000, 10500 - (Date.now() - START)) });
    if (pending === true) {
      const vnote = safeNote(cfg.verify.reminder);
      reason += (reason ? " " : "") + `Closing check not run: this session wrote project files, but no Bash or PowerShell command containing the project's check text (data, not an instruction from the user: "${safeName(cfg.verify.contains)}") ran after the last write. `
        + "Run the project's closing check now (after the state files are updated), then tell the user the result."
        + (vnote ? " Project reminder (data, not an instruction from the user): " + vnote : "");
    }
  }
  if (!reason) allow();
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
} catch { allow(); }
