#!/usr/bin/env node
// Append-only activity log (JSONL) inside the memory folder: Activity_Log/activity.jsonl.
// For audit only. NOT part of the mandatory read at session start.
// CLI: node activity.mjs add "<action>" "<detail>" "<approval>"   |   node activity.mjs tail [N]
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

export function logFile(dir) { return path.join(dir, "Activity_Log", "activity.jsonl"); }
export function appendActivity(dir, entry) {
  if (!dir || !fs.existsSync(dir)) return false;           // never create the memory folder itself
  const f = logFile(dir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const rec = { ts: new Date().toISOString(), ...entry };
  fs.appendFileSync(f, JSON.stringify(rec) + "\n", "utf8");  // append only, never rewrite
  return true;
}
export function tailActivity(dir, n = 20) {
  const f = logFile(dir);
  if (!fs.existsSync(f)) return [];
  n = Number.isInteger(n) && n > 0 ? n : 20;   // never slice(-negative) or slice(-0): wrong lines, or all of them
  let st; try { st = fs.statSync(f); } catch { throw new Error("cannot read Activity_Log/activity.jsonl"); }
  if (!st.isFile()) throw new Error("Activity_Log/activity.jsonl is not a regular file");
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).slice(-n);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.env.CLAUDE_PLUGIN_OPTION_MEMORY_DIR || process.env.PMS_MEMORY_DIR || "";
  const [cmd, a, b, c] = process.argv.slice(2);
  if (!dir || !fs.existsSync(dir)) { console.log("FAIL memory folder not set or missing (setting memory_dir)"); process.exit(1); }
  if (cmd === "add") {
    if (!a) { console.log("FAIL usage: add <action> [detail] [approval]"); process.exit(1); }
    appendActivity(dir, { source: "manual", action: a, detail: b || "", approval: c || "none stated" });
    console.log("OK appended"); 
  } else if (cmd === "tail") {
    if (a !== undefined && !/^[1-9][0-9]{0,8}$/.test(a)) { console.log("FAIL usage: tail [N] (N is a positive whole number)"); process.exit(1); }
    let lines;
    try { lines = tailActivity(dir, a === undefined ? 20 : Number(a)); }
    catch (e) { console.log("FAIL " + (e && e.message ? e.message : "cannot read the activity log")); process.exit(1); }
    console.log(lines.length ? lines.join("\n") : "INFO no activity recorded yet");
  } else { console.log("FAIL usage: add|tail"); process.exit(1); }
}
