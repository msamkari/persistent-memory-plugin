// Freshness check for the opt-in Stop hook (hooks/end-of-work.mjs). Read-only, no network.
// A project opts in by adding MDs/freshness.json:
//   { "state": ["MDs/HANDOVER.md", "Jobs/state_manifest.json"],   // files that must be updated after work
//     "work":  ["Jobs/", "MDs/Templates/", "notes.md"],             // folders (end with "/") or exact files
//     "extensions": [".md"],                                        // only for folder entries (default [".md"])
//     "skip": ["_Archive", "_merged"],                              // extra folder names to skip
//     "reasonExtra": "text appended to the block message",          // optional
//     "verify": { "contains": "inventory.py", "reminder": "..." } } // optional: a closing check that must run after the last write
// Rule: if a work file is newer than the OLDEST state file, the state is stale.
// The hook then counts only work files THIS session wrote (see writtenByThisSession).
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { safeName } from "./safe-name.mjs";

export const CONFIG_REL = ["MDs", "freshness.json"];
const DEFAULT_SKIP = ["_Archive", "_archive", "System_Previous_MDs", "_merged", "_proposals", "node_modules", ".git"];
const MAX_FILES = 20000, MAX_DEPTH = 12;

const slash = (s) => String(s).replace(/\\/g, "/");

// A path entry that stays inside the project and names something below the root: no "..", not the root itself
// ("./", ".", "/", ""), not a drive-letter or absolute form.
const entryProblem = (e) => {
  const segs = slash(e).split("/").filter((x) => x && x !== ".");
  if (segs.length === 0) return "names the project folder itself";
  if (segs.includes("..")) return 'contains ".."';
  if (/^[A-Za-z]:/.test(segs[0])) return "is a drive path";
  return "";
};
// Returns { cfg } or { error } (a clear config problem). The Stop hook treats an error like "no config": it fails open.
export function loadConfigChecked(root) {
  let cfg;
  try {
    let raw = fs.readFileSync(path.join(root, ...CONFIG_REL), "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // a BOM breaks JSON.parse (PowerShell 5.1 writes one)
    cfg = JSON.parse(raw);
  } catch { return { error: "MDs/freshness.json is missing or is not valid JSON" }; }
  if (!cfg || typeof cfg !== "object") return { error: "MDs/freshness.json must be an object" };
  if (!Array.isArray(cfg.state) || cfg.state.length === 0 || !cfg.state.every((s) => typeof s === "string")) return { error: '"state" must be a non-empty list of file paths' };
  if (!Array.isArray(cfg.work) || cfg.work.length === 0 || !cfg.work.every((s) => typeof s === "string")) return { error: '"work" must be a non-empty list of paths' };
  for (const e of cfg.state) { const pr = entryProblem(e); if (pr) return { error: `"state" entry ${JSON.stringify(String(e).slice(0, 60))} ${pr}; the end-of-work check is off until it is fixed` }; }
  // "work" entries that name the root itself or leave the project are ignored; nothing valid left = a config error
  const work = cfg.work.filter((e) => !entryProblem(e));
  if (work.length === 0) return { error: 'no usable "work" entry (each one names the project folder itself or contains ".."); the end-of-work check is off until it is fixed' };
  let extensions = [".md"];
  if (Array.isArray(cfg.extensions) && cfg.extensions.length) {
    extensions = cfg.extensions.map(String).filter((x) => x.trim() !== ""); // an empty extension would match every file
    if (extensions.length === 0) return { error: '"extensions" has only empty entries (it would match every file); the end-of-work check is off until it is fixed' };
  }
  // Optional closing check. A bad "verify" is ignored (the rest of the config still works) and reported in "warn".
  let verify = null, warn = "";
  if (cfg.verify !== undefined && cfg.verify !== null) {
    const v = cfg.verify;
    const contains = v && typeof v === "object" && !Array.isArray(v) && typeof v.contains === "string" ? v.contains.trim() : "";
    if (!v || typeof v !== "object" || Array.isArray(v)) warn = '"verify" must be an object like { "contains": "inventory.py", "reminder": "..." }';
    else if ([...contains].length < 4 || [...contains].length > 80 || contains.startsWith(".")) warn = '"verify.contains" must be a text of 4 to 80 characters (not counting outer spaces) and must not start with "." (too generic)';
    else if (safeName(contains, 1000) !== contains || /[^\S ]/.test(contains)) warn = '"verify.contains" must be plain text: no control, zero-width, bidi, tab, newline or no-break-space characters, no double spaces (the text shown in the message must be the text that is matched)';
    else if (v.reminder !== undefined && typeof v.reminder !== "string") warn = '"verify.reminder" must be a text';
    else verify = { contains, reminder: typeof v.reminder === "string" ? v.reminder : "" };
    if (warn) warn += "; the closing-check step (verify) is ignored until it is fixed";
  }
  return { warn, cfg: {
    verify,
    disabled: cfg.disabled === true, // keeps the config but switches the hook off for this project
    state: cfg.state.map(slash),
    work: work.map(slash),
    extensions,
    skip: new Set([...DEFAULT_SKIP, ...(Array.isArray(cfg.skip) ? cfg.skip.map(String) : [])]),
    reasonExtra: typeof cfg.reasonExtra === "string" ? cfg.reasonExtra : "",
  } };
}
export function loadConfig(root) { return loadConfigChecked(root).cfg || null; }

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

// Text of the first user message of a transcript: the first line that is a user turn (type "user", or the
// queue entry that carries the prompt). Later messages, tool results and pasted text never count.
function firstUserText(transcriptPath) {
  const fd = fs.openSync(transcriptPath, "r");
  let text = "";
  try {
    const buf = Buffer.alloc(262144); const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const lines = buf.subarray(0, n).toString("utf8").split("\n");
    if (n === buf.length) lines.pop();                 // the last line may be cut off
    for (const line of lines) {
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (!o || typeof o !== "object") continue;
      let c;
      if (o.type === "queue-operation" && typeof o.content === "string") c = o.content;
      else if (o.type === "user" && o.message) c = o.message.content;
      else continue;
      if (Array.isArray(c)) c = c.map((b) => (b && typeof b.text === "string" ? b.text : "")).join("\n");
      if (typeof c === "string" && c.trim()) { text = c; break; }
    }
  } finally { fs.closeSync(fd); }
  return text;
}
export function isScheduledTask(transcriptPath) {
  try { return firstUserText(transcriptPath).includes("<scheduled-task"); } catch { return false; }
}

// Subagents spawned by this session keep their own transcripts next to the main one:
// <dir>/<session>.jsonl  ->  <dir>/<session>/subagents/agent-*.jsonl. Their tool calls are this session's work too.
export function subagentTranscripts(transcriptPath) {
  try {
    const dir = path.join(path.dirname(transcriptPath), path.basename(transcriptPath, path.extname(transcriptPath)), "subagents");
    return fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")).map((n) => path.join(dir, n));
  } catch { return []; }
}

// Compare paths as Unicode NFC so a decomposed name in the transcript still matches the composed name on disk.
const fold = (s) => slash(s).normalize("NFC").toLowerCase();

// Which of the candidate files did THIS session write? Parses tool_use blocks of the JSONL transcript
// (and of this session's subagent transcripts): file tools by their file_path, shell tools by a write-looking
// command that names the path. A mere read or a mention in text does not count.
// Bounded by bytes and time over all files together; on a bound it returns what it found.
export async function writtenByThisSession(transcriptPath, rels, { maxMs = 8000, maxBytes = 400 * 1024 * 1024, root = "" } = {}) {
  const found = new Set();
  // With a project root, a file tool's path is resolved against it (relative paths too) and must be exactly the
  // project file: a same-named file in another folder is not this project's.
  // Plain string folding, not path.resolve: a transcript written on Windows (C:\...) must still match when this runs elsewhere.
  let roots = [];
  if (root) { roots = [fold(root).replace(/\/+$/, "")]; try { const r = fold(fs.realpathSync.native(root)).replace(/\/+$/, ""); if (!roots.includes(r)) roots.push(r); } catch { /* keep the given root */ } }
  const lower = rels.map((r) => [r, fold(r)]);
  const full = roots.length ? lower.map(([r, l]) => [r, roots.map((x) => x + "/" + l)]) : [];
  const isAbs = (p) => /^([a-z]:)?\//.test(p);
  const tails = lower.map(([r, l]) => [r, l, l.split("/").slice(-2).join("/")]);
  const t0 = Date.now(); let bytes = 0;
  for (const file of [transcriptPath, ...subagentTranscripts(transcriptPath)]) {
    const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
    rl.on("error", () => {}); // a vanished subagent file must not abort the scan
    let over = false;
    try {
      for await (const line of rl) {
        bytes += line.length;
        if (Date.now() - t0 > maxMs || bytes > maxBytes) { over = true; break; }
        if (!line.includes('"tool_use"')) continue;
        const norm = fold(line).replace(/\/\/+/g, "/"); // JSON-escaped backslashes become "//": collapse them
        if (!tails.some(([, , tail]) => norm.includes(tail))) continue;
        let obj; try { obj = JSON.parse(line); } catch { continue; }
        const content = obj?.message?.content;
        if (!Array.isArray(content)) continue;
        for (const b of content) {
          if (b?.type !== "tool_use" || !b.input) continue;
          if (FILE_TOOLS.has(b.name)) {
            const raw = b.input.file_path || b.input.notebook_path || "";
            if (roots.length) { let fp = fold(String(raw)); if (!isAbs(fp)) fp = roots[0] + "/" + fp.replace(/^\.\//, ""); for (const [r, ls] of full) if (ls.includes(fp)) found.add(r); }
            else { const fp = fold(raw); for (const [r, l] of lower) if (fp === l) found.add(r); }
          } else if (SHELL_TOOLS.has(b.name)) {
            const cmd = fold(b.input.command || "").replace(/\/\/+/g, "/");
            if (WRITEISH.test(cmd)) for (const [r, l] of lower) if (cmd.includes(l)) found.add(r);
          }
        }
        if (found.size === rels.length) break;
      }
    } catch { /* unreadable file: keep what was found */ } finally { rl.close(); }
    if (over || found.size === rels.length) break;
  }
  return found;
}

// Opt-in "verify" step. Returns true when this session (and its subagents) wrote at least one file that counts as
// work or state, and no Bash/PowerShell command containing verify.contains (case-insensitive) ran AFTER every such write.
// false = nothing to verify; null = a bound was hit (the caller fails open). Reads the transcript only; runs nothing.
// Order: inside one transcript by position; across transcripts (subagents) by line timestamps, and when either
// timestamp is missing the order is unknown, so that command does not count (the hook asks once, never loops).
// A command that contains the needle is a verification, never a write (so "check.py > Jobs/out.md" is not a new write).
export async function verifyPending(transcriptPath, cfg, { maxMs = 8000, maxBytes = 400 * 1024 * 1024, root = "" } = {}) {
  if (!cfg || !cfg.verify || !root) return false;
  const needle = fold(cfg.verify.contains);
  const roots = [fold(root).replace(/\/+$/, "")];
  try { const r = fold(fs.realpathSync.native(root)).replace(/\/+$/, ""); if (!roots.includes(r)) roots.push(r); } catch { /* keep the given root */ }
  const isAbs = (p) => /^([a-z]:)?\//.test(p);
  const state = new Set(cfg.state.map(fold));
  const exts = cfg.extensions.map((x) => x.toLowerCase());
  const work = cfg.work.map(fold);
  const skip = new Set([...cfg.skip].map((x) => String(x)));
  const relOf = (raw) => {
    let fp = path.posix.normalize(fold(raw)); if (!fp) return "";
    if (!isAbs(fp)) fp = path.posix.normalize(roots[0] + "/" + fp);
    for (const r of roots) if (fp.startsWith(r + "/")) return fp.slice(r.length + 1);
    return "";
  };
  const counts = (rel) => {
    if (!rel || rel.startsWith("../")) return false;
    if (state.has(rel)) return true;
    return work.some((w) => {
      if (!w.endsWith("/")) return rel === w;
      if (!rel.startsWith(w) || !exts.some((x) => rel.endsWith(x))) return false;
      return !rel.split("/").slice(0, -1).some((seg) => skip.has(seg) || skip.has(seg.toLowerCase()));
    });
  };
  const shellWrite = (cmd) => WRITEISH.test(cmd) && (cfg.state.some((s) => cmd.includes(fold(s))) || work.some((w) => cmd.includes(w)));
  const writes = [], verifies = [];
  const seenIds = new Set();                       // a tool_use id counts once: copies (api-request-blob lines) are not new events
  const esc = (h) => JSON.stringify(h).slice(1, -1); // the line is JSON text: a quote or backslash in a path or the needle is escaped there
  const hints = [needle, ...cfg.state.map(fold), ...work].flatMap((h) => [h, fold(esc(h))]).map((h) => h.replace(/\/\/+/g, "/"));
  const t0 = Date.now(); let bytes = 0, over = false;
  const files = [transcriptPath, ...subagentTranscripts(transcriptPath)];
  for (let fi = 0; fi < files.length && !over; fi++) {
    const rl = readline.createInterface({ input: fs.createReadStream(files[fi], { encoding: "utf8" }), crlfDelay: Infinity });
    rl.on("error", () => {});
    let n = 0;
    try {
      for await (const line of rl) {
        n++; bytes += line.length;
        if (Date.now() - t0 > maxMs || bytes > maxBytes) { over = true; break; }
        if (!line.includes('"tool_use"')) continue;
        const norm = fold(line).replace(/\/\/+/g, "/");   // same cheap prefilter as writtenByThisSession
        if (!hints.some((h) => norm.includes(h))) continue;
        let obj; try { obj = JSON.parse(line); } catch { continue; }
        if (obj?.type !== "assistant") continue;       // only real assistant turns (not api-request-blob copies, results, queue lines)
        const content = obj?.message?.content; if (!Array.isArray(content)) continue;
        const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN;
        content.forEach((b, bi) => {
          if (b?.type !== "tool_use" || !b.input) return;
          if (typeof b.id === "string" && b.id) { if (seenIds.has(b.id)) return; seenIds.add(b.id); }
          const ev = { f: fi, s: n * 1000 + bi, ts };
          if (FILE_TOOLS.has(b.name)) { if (counts(relOf(String(b.input.file_path || b.input.notebook_path || "")))) writes.push(ev); }
          else if (SHELL_TOOLS.has(b.name)) {
            const cmd = fold(b.input.command || "");
            if (cmd.includes(needle)) verifies.push(ev);
            else if (shellWrite(cmd.replace(/\/\/+/g, "/"))) writes.push(ev);
          }
        });
      }
    } catch { /* unreadable file: keep what was found */ } finally { rl.close(); }
  }
  if (over) return null;
  if (writes.length === 0) return false;
  const after = (a, b) => (a.f === b.f ? a.s > b.s : Number.isFinite(a.ts) && Number.isFinite(b.ts) && a.ts > b.ts);
  return !verifies.some((v) => writes.every((w) => after(v, w)));
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
    if (fs.existsSync(cfgPath)) {
      console.log(`OK ${path.join(...CONFIG_REL)} already exists; nothing to do (init never overwrites).`);
      const w = loadConfigChecked(root).warn; if (w) console.log("NOTE " + w);
      return 0;
    }
    const s = suggestConfig(root);
    if (!s) { console.log("FAIL could not suggest a config: need a HANDOVER.md (root or MDs/) and a work folder (Jobs/ or MDs/Templates/). Write MDs/freshness.json by hand: see docs/end-of-work.md"); return 2; }
    const text = JSON.stringify(s, null, 2) + "\n";
    if (args.includes("--write")) { fs.mkdirSync(path.dirname(cfgPath), { recursive: true }); fs.writeFileSync(cfgPath, text, { encoding: "utf8", flag: "wx" }); console.log(`OK wrote ${cfgPath}`); }
    else console.log(`Suggested ${path.join(...CONFIG_REL)} (not written; add --write to create it, then review it):\n${text}`);
    return 0;
  }
  if (cmd === "check") {
    const { cfg, error, warn } = loadConfigChecked(root);
    if (warn) console.log("NOTE " + warn);
    if (!cfg) { console.log("FAIL no valid MDs/freshness.json in " + root + ": " + error); return 2; }
    if (cfg.verify) console.log(`NOTE verify is on: the hook also asks for a Bash/PowerShell command containing "${safeName(cfg.verify.contains)}" after the last write.`);
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
