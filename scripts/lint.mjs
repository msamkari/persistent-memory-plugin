#!/usr/bin/env node
// memory-lint: deterministic cross-reference checks over memory .md files.
// Default is read-only. --apply fixes only mechanical path typos, archiving first.
import fs from "node:fs"; import path from "node:path";
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dirArg = args.find(a => !a.startsWith("--"));
const root = dirArg || process.env.CLAUDE_PLUGIN_OPTION_MEMORY_DIR || process.env.PMS_MEMORY_DIR || "";
const out = []; let fails = 0;
const say = (lvl, m) => { out.push(`${lvl} ${m}`); if (lvl === "FAIL") fails++; };
const D = s => s.replace(/[٠-٩]/g, c => String.fromCharCode(c.charCodeAt(0) - 1632));
const cur = path.join(root, "MDs", "System_Current_MD");
if (!root || !fs.existsSync(cur)) { say("FAIL", "MDs/System_Current_MD not found (give the memory folder as argument)"); finish(); }
const read = f => D(fs.readFileSync(path.join(cur, f), "utf8"));
const files = fs.readdirSync(cur).filter(f => f.endsWith(".md")).sort();
const log = files.find(f => /^02_/.test(f));
let max = 0;
if (!log) say("WARN", "no 02_* log file; numbering checks skipped");
else {
  const t = read(log), nums = [];
  for (const m of t.matchAll(/^\d{4}-\d\d-\d\d \((\d+)\)/gm)) nums.push(+m[1]);
  const covered = new Set(nums);
  for (const m of t.matchAll(/مدخلات (\d+) إلى (\d+)/g)) for (let i = +m[1]; i <= +m[2]; i++) covered.add(i);
  max = Math.max(0, ...covered);
  const dup = nums.filter((n, i) => nums.indexOf(n) !== i);
  const gaps = []; for (let i = 1; i <= max; i++) if (!covered.has(i)) gaps.push(i);
  say(dup.length ? "FAIL" : "PASS", dup.length ? `duplicate entry numbers: ${[...new Set(dup)].join(",")}` : `entry numbers unique (1..${max})`);
  say(gaps.length ? "FAIL" : "PASS", gaps.length ? `missing entry numbers: ${gaps.join(",")}` : "entry numbering has no gaps");
  const bad = [];
  for (const f of files) for (const m of read(f).matchAll(/(?:بند|البند|بنود|item) ?(\d+)(?!\d)/g)) if (+m[1] > max || +m[1] < 1) bad.push(`${f}: ${m[0]}`);
  say(bad.length ? "FAIL" : "PASS", bad.length ? `references to non-existent entries: ${[...new Set(bad)].slice(0, 8).join("; ")}` : "all entry references point to existing entries");
}
// archive links
const prevRoot = path.join(root, "MDs", "System_Previous_MDs");
const fixes = [];
if (!fs.existsSync(prevRoot)) say("WARN", "System_Previous_MDs not present; archive-link check skipped");
else {
  const miss = [];
  for (const f of files) {
    const t = fs.readFileSync(path.join(cur, f), "utf8");
    for (const m of t.matchAll(/System_Previous_MDs\/(\d{4}-\d\d)\/([^\s)`'"،]+?\.md)/g)) {
      const p = path.join(prevRoot, m[1], m[2]);
      if (fs.existsSync(p)) continue;
      const dir = path.join(prevRoot, m[1]);
      const stem = m[2].replace(/_\d{4}-\d\d-\d\d.*$/, "");
      const near = fs.existsSync(dir) ? fs.readdirSync(dir).filter(x => x.startsWith(stem) && x.length <= m[2].length + 3 && x.length >= m[2].length - 3) : [];
      miss.push(`${f}: ${m[0]}`);
      if (near.length === 1) fixes.push({ f, from: m[2], to: near[0] });
    }
  }
  say(miss.length ? "FAIL" : "PASS", miss.length ? `archive links to missing files (${miss.length}): ${miss.slice(0, 5).join("; ")}` : "all archive links exist");
}
for (const x of fixes) say("INFO", `unique fix: ${x.f}: ${x.from} -> ${x.to}`);
// jobs
const jobs = path.join(root, "Jobs");
if (fs.existsSync(jobs)) for (const f of fs.readdirSync(jobs).filter(f => f.endsWith(".md"))) {
  const jt = fs.readFileSync(path.join(jobs, f), "utf8");
  if (!/STATUS/i.test(jt)) say("WARN", `Jobs/${f}: no STATUS block`);
  else if (!/BUDGET|الميزانية|سقف/i.test(jt) && /STATUS[^\n]*\n[^\n]*(IN PROGRESS|قيد|جارٍ|جاري)/i.test(jt)) say("WARN", `Jobs/${f}: active job has no BUDGET line (add e.g. "BUDGET: max 5 USD or 3 rounds; stop and report when reached")`);
}
if (apply && fixes.length) {
  const ym = new Date().toISOString().slice(0, 7), ds = new Date().toISOString().slice(0, 10);
  const ad = path.join(prevRoot, ym); fs.mkdirSync(ad, { recursive: true });
  for (const f of [...new Set(fixes.map(x => x.f))]) {
    const dst = path.join(ad, f.replace(/\.md$/, `_${ds}_prelint.md`));
    if (fs.existsSync(dst)) { say("FAIL", `archive target exists, not overwriting: ${dst}`); continue; }
    fs.copyFileSync(path.join(cur, f), dst);           // archive first
    let t = fs.readFileSync(path.join(cur, f), "utf8");
    for (const x of fixes.filter(x => x.f === f)) t = t.split(x.from).join(x.to);
    fs.writeFileSync(path.join(cur, f), t);
    say("INFO", `fixed ${f}; old copy: ${dst}`);
  }
} else if (fixes.length) say("INFO", "dry run: re-run with --apply to apply the unique path fixes (archives first)");
say("INFO", "lint cannot judge factual citations (e.g. wrong page numbers); use the memory-verifier agent for that");
finish();
function finish() { console.log(out.join("\n")); console.log(fails ? `RESULT: FAIL (${fails})` : "RESULT: OK"); process.exit(fails ? 1 : 0); }
