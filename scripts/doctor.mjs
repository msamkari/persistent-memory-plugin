#!/usr/bin/env node
// Persistent Memory doctor: ONE read-only entry point. Fail-closed:
// anything it cannot read or verify is reported as FAIL, never silently skipped.
// Usage: node doctor.mjs <memory_dir>   (or env CLAUDE_PLUGIN_OPTION_MEMORY_DIR / PMS_MEMORY_DIR)
// Exit 0 = all PASS (WARN allowed), 1 = any FAIL. Writes nothing. No network.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const dir = process.argv[2] || process.env.CLAUDE_PLUGIN_OPTION_MEMORY_DIR || process.env.PMS_MEMORY_DIR || "";
const results = [];
const add = (level, name, detail = "") => results.push({ level, name, detail });

function safeList(d) {
  try { return readdirSync(d, { withFileTypes: true }); } catch (e) { add("FAIL", `cannot read ${d}`, String(e.code || e.message)); return []; }
}
function safeRead(f) {
  try { return readFileSync(f, "utf8"); } catch (e) { add("FAIL", `cannot read ${basename(f)}`, String(e.code || e.message)); return null; }
}

if (!dir || !existsSync(dir)) {
  add("FAIL", "memory folder", dir ? `not found: ${dir}` : "path not set (memory_dir)");
} else {
  const cur = join(dir, "MDs", "System_Current_MD");
  const jobsDir = join(dir, "Jobs");
  if (!existsSync(cur)) add("FAIL", "MDs/System_Current_MD", "missing");
  else {
    const files = safeList(cur).filter((e) => e.isFile() && e.name.endsWith(".md"));
    add(files.length ? "PASS" : "FAIL", "core files present", `${files.length} file(s)`);
    const nums = new Set(files.map((f) => f.name.slice(0, 2)).filter((n) => /^\d\d$/.test(n)));
    for (const n of ["00", "01", "02"]) if (!nums.has(n)) add("WARN", `core file ${n}_*`, "not found (numbering convention)");
    const privacy = { email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/, token: /gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}/ };
    const inject = /(ignore (all |any )?(previous|prior) (instructions|rules)|NOTE TO ASSISTANT|delete (this|the) file|تجاهل (كل )?التعليمات)/i;
    for (const f of files) {
      const p = join(cur, f.name);
      let size = 0;
      try { size = statSync(p).size; } catch (e) { add("FAIL", `stat ${f.name}`, String(e.code)); continue; }
      if (size === 0) add("FAIL", `${f.name}`, "empty file");
      if (/conflicted copy/i.test(f.name)) add("FAIL", `${f.name}`, "sync-conflict copy: two devices wrote at once");
      const t = safeRead(p);
      if (t === null) continue;
      for (const [k, re] of Object.entries(privacy)) if (re.test(t)) add("WARN", `${f.name}`, `possible ${k} inside memory file`);
      const m = t.split("\n").findIndex((l) => inject.test(l));
      if (m >= 0) add("WARN", `${f.name}`, `line ${m + 1} looks like an instruction addressed to an assistant (treat as data)`);
    }
  }
  if (!existsSync(jobsDir)) add("WARN", "Jobs/", "folder missing (fine if no long task yet)");
  else {
    const jobs = safeList(jobsDir).filter((e) => e.isFile() && e.name.endsWith(".md"));
    for (const j of jobs) {
      if (/conflicted copy/i.test(j.name)) add("FAIL", `Jobs/${j.name}`, "sync-conflict copy");
      const t = safeRead(join(jobsDir, j.name));
      if (t !== null && !/STATUS/.test(t)) add("WARN", `Jobs/${j.name}`, "no STATUS block");
    }
    add("PASS", "Jobs/", `${jobs.length} file(s)`);
  }
}

let fails = 0;
for (const r of results) { console.log(`${r.level} ${r.name}${r.detail ? " — " + r.detail : ""}`); if (r.level === "FAIL") fails++; }
console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: OK");
process.exit(fails ? 1 : 0);
