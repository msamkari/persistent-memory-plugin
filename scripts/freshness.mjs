// Freshness check for the opt-in Stop hook (hooks/end-of-work.mjs). Read-only, no network.
// A project opts in by adding MDs/freshness.json:
//   { "state": ["MDs/HANDOVER.md", "Jobs/state_manifest.json"],   // files that must be updated after work
//     "work":  ["Jobs/", "MDs/Templates/", "notes.md"],             // folders (end with "/") or exact files
//     "extensions": [".md"],                                        // only for folder entries (default [".md"])
//     "skip": ["_Archive", "_merged"],                              // extra folder names to skip
//     "reasonExtra": "text appended to the block message" }         // optional
// Rule: if a work file is newer than the OLDEST state file, the state is stale.
// The hook then counts only work files THIS session wrote (see writtenByThisSession).
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

export const CONFIG_REL = ["MDs", "freshness.json"];
const DEFAULT_SKIP = ["_Archive", "_archive", "System_Previous_MDs", "_merged", "_proposals", "node_modules", ".git"];
const MAX_FILES = 20000, MAX_DEPTH = 12;

const slash = (s) => String(s).replace(/\\/g, "/");

export function loadConfig(root) {
  try {
    let raw = fs.readFileSync(path.join(root, ...CONFIG_REL), "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // a BOM breaks JSON.parse (PowerShell 5.1 writes one)
    const cfg = JSON.parse(raw);
    if (!Array.isArray(cfg.state) || cfg.state.length === 0 || !cfg.state.every((s) => typeof s === "string")) return null;
    if (!Array.isArray(cfg.work) || cfg.work.length === 0 || !cfg.work.every((s) => typeof s === "string")) return null;
    return {
      disabled: cfg.disabled === true, // keeps the config but switches the hook off for this project
      state: cfg.state.map(slash),
      work: cfg.work.map(slash),
      extensions: Array.isArray(cfg.extensions) && cfg.extensions.length ? cfg.extensions.map(String) : [".md"],
      skip: new Set([...DEFAULT_SKIP, ...(Array.isArray(cfg.skip) ? cfg.skip.map(String) : [])]),
      reasonExtra: typeof cfg.reasonExtra === "string" ? cfg.reasonExtra : "",
    };
  } catch { return null; }
}

function walk(dir, cfg, depth, out) {
  if (depth > MAX_DEPTH || out.size >= MAX_FILES) return;
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!cfg.skip.has(e.name)) walk(p, cfg, depth + 1, out); }
    else if (e.isFile() && cfg.extensions.some((x) => e.name.toLowerCase().endsWith(x.toLowerCase()))) {
      try { out.set(p, fs.statSync(p).mtimeMs); } catch { /* vanished */ }
      if (out.size >= MAX_FILES) return;
    }
  }
}

// Returns { oldest, newer: [{rel, mtime}] } or null when the state files cannot be read (fail open).
export function staleReport(root, cfg, since = null, slackMs = 2000) {
  const times = [];
  for (const rel of cfg.state) {
    try { const st = fs.statSync(path.join(root, ...rel.split("/"))); if (!st.isFile()) return null; times.push([rel, st.mtimeMs]); }
    catch { return null; }
  }
  const [oldestRel, oldest] = times.reduce((a, b) => (b[1] < a[1] ? b : a));
  const files = new Map();
  for (const w of cfg.work) {
    const p = path.join(root, ...w.split("/").filter(Boolean));
    if (w.endsWith("/")) walk(p, cfg, 0, files);
    else { try { const st = fs.statSync(p); if (st.isFile()) files.set(p, st.mtimeMs); } catch { /* absent */ } }
  }
  const stateSet = new Set(cfg.state.map((s) => path.normalize(path.join(root, ...s.split("/")))));
  const newer = [];
  for (const [p, t] of files) {
    if (stateSet.has(path.normalize(p))) continue;
    if (since != null && t <= since) continue;
    if (t > oldest + slackMs) newer.push({ rel: slash(path.relative(root, p)), mtime: t });
  }
  newer.sort((a, b) => b.mtime - a.mtime);
  return { oldest, oldestRel, newer };
}

const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
// A shell command counts as a possible write only if it looks like one (redirect, copy, move, in-place edit, ...).
const WRITEISH = /(>>?|\btee\b|\bsed\s+-i|\bcp\b|\bmv\b|\brm\b|\bSet-Content\b|\bAdd-Content\b|\bOut-File\b|\bWriteAllText\b|\bAppendAllText\b|\bNew-Item\b|\bCopy-Item\b|\bMove-Item\b|\bwrite|\bunlink\b)/i;

export function sessionStartMs(transcriptPath) {
  try {
    const fd = fs.openSync(transcriptPath, "r");
    const buf = Buffer.alloc(16384); const n = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
    const first = buf.subarray(0, n).toString("utf8").split("\n")[0];
    const ts = JSON.parse(first).timestamp;
    const ms = ts ? Date.parse(ts) : NaN;
    if (!Number.isNaN(ms)) return ms;
  } catch { /* fall through */ }
  try { return fs.statSync(transcriptPath).birthtimeMs || null; } catch { return null; }
}

export function isScheduledTask(transcriptPath) {
  try {
    const fd = fs.openSync(transcriptPath, "r");
    const buf = Buffer.alloc(8000); const n = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
    return buf.subarray(0, n).toString("utf8").includes("<scheduled-task");
  } catch { return false; }
}

// Which of the candidate files did THIS session write? Parses tool_use blocks of the JSONL transcript:
// file tools by their file_path, shell tools by a write-looking command that names the path.
// A mere read or a mention in text does not count. Bounded by bytes and time; on a bound it returns what it found.
export async function writtenByThisSession(transcriptPath, rels, { maxMs = 8000, maxBytes = 400 * 1024 * 1024 } = {}) {
  const found = new Set();
  const lower = rels.map((r) => [r, slash(r).toLowerCase()]);
  const t0 = Date.now(); let bytes = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(transcriptPath, { encoding: "utf8" }), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      bytes += line.length;
      if (Date.now() - t0 > maxMs || bytes > maxBytes) break;
      if (!line.includes('"tool_use"')) continue;
      const tails = lower.map(([r, l]) => [r, l, l.split("/").slice(-2).join("/")]);
      const flat = slash(line).toLowerCase(); // JSON-escaped backslashes become "//": collapse them
      const norm = flat.replace(/\/\/+/g, "/");
      if (!tails.some(([, , tail]) => norm.includes(tail))) continue;
      let obj; try { obj = JSON.parse(line); } catch { continue; }
      const content = obj?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (b?.type !== "tool_use" || !b.input) continue;
        if (FILE_TOOLS.has(b.name)) {
          const fp = slash(b.input.file_path || b.input.notebook_path || "").toLowerCase();
          for (const [r, l] of lower) if (fp === l || fp.endsWith("/" + l)) found.add(r);
        } else if (SHELL_TOOLS.has(b.name)) {
          const cmd = slash(b.input.command || "").toLowerCase().replace(/\/\/+/g, "/");
          if (WRITEISH.test(cmd)) for (const [r, l] of lower) if (cmd.includes(l)) found.add(r);
        }
      }
      if (found.size === rels.length) break;
    }
  } finally { rl.close(); }
  return found;
}

// ---- CLI: node scripts/freshness.mjs init|check [--root DIR] [--write] ----
// init  : looks at the project and PRINTS a suggested MDs/freshness.json. Read-only unless --write, which
//         creates the file only if it does not exist yet (never overwrites).
// check : runs the same comparison as the Stop hook once, by hand. Exit 0 current, 1 stale, 2 no/invalid config.
import { fileURLToPath } from "node:url";

const exists = (root, rel) => { try { return fs.statSync(path.join(root, ...rel.split("/"))).isFile(); } catch { return false; } };
const isDir = (root, rel) => { try { return fs.statSync(path.join(root, ...rel.split("/"))).isDirectory(); } catch { return false; } };

export function suggestConfig(root) {
  const handover = ["MDs/HANDOVER.md", "HANDOVER.md"].find((r) => exists(root, r));
  if (!handover) return null; // nothing to anchor the state on
  const manifest = ["Jobs/state_manifest.json", "state_manifest.json", "MDs/state_manifest.json"].find((r) => exists(root, r));
  const work = ["Jobs/", "MDs/Templates/"].filter((r) => isDir(root, r.slice(0, -1)));
  if (work.length === 0) return null; // no obvious work-log folder: the user must name one
  return { state: [...(manifest ? [manifest] : []), handover], work };
}

function cli() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const ri = args.indexOf("--root");
  const root = path.resolve(ri >= 0 && args[ri + 1] ? args[ri + 1] : process.cwd());
  const cfgPath = path.join(root, ...CONFIG_REL);
  if (cmd === "init") {
    if (fs.existsSync(cfgPath)) { console.log(`OK ${path.join(...CONFIG_REL)} already exists; nothing to do (init never overwrites).`); return 0; }
    const s = suggestConfig(root);
    if (!s) { console.log("FAIL could not suggest a config: need a HANDOVER.md (root or MDs/) and a work folder (Jobs/ or MDs/Templates/). Write MDs/freshness.json by hand: see docs/end-of-work.md"); return 2; }
    const text = JSON.stringify(s, null, 2) + "\n";
    if (args.includes("--write")) { fs.mkdirSync(path.dirname(cfgPath), { recursive: true }); fs.writeFileSync(cfgPath, text, { encoding: "utf8", flag: "wx" }); console.log(`OK wrote ${cfgPath}`); }
    else console.log(`Suggested ${path.join(...CONFIG_REL)} (not written; add --write to create it, then review it):\n${text}`);
    return 0;
  }
  if (cmd === "check") {
    const cfg = loadConfig(root);
    if (!cfg) { console.log("FAIL no valid MDs/freshness.json in " + root); return 2; }
    if (cfg.disabled) { console.log("OK disabled in the config"); return 0; }
    const rep = staleReport(root, cfg, null);
    if (!rep) { console.log("FAIL a state file listed in the config is missing"); return 2; }
    if (rep.newer.length === 0) { console.log("OK state files are current"); return 0; }
    console.log(`STALE: newer than ${rep.oldestRel}:\n` + rep.newer.map((n) => "  " + n.rel).join("\n"));
    return 1;
  }
  console.log("usage: node scripts/freshness.mjs init [--root DIR] [--write] | check [--root DIR]");
  return 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(cli());
