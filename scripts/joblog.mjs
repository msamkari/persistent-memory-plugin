#!/usr/bin/env node
// Job-log helper: appends ONE line to a log file inside a project's Jobs/ or MDs/ folder, so unattended
// (scheduled) sessions do not have to write it through the shell (`printf '...' >> file`), where quotes,
// brackets and slashes in the text trip the permission system and a broad allow rule such as Bash(printf:*)
// would let a session write ANY file. This script can only append, only one line, only inside the project.
//
// CLI: node joblog.mjs --root DIR --file Jobs/log.md (--text "line" | --stdin) [--stamp] [--create] [--dry-run]
//   --root     project folder (default: CLAUDE_PROJECT_DIR, then the current folder)
//   --file     path RELATIVE to the root; must be under Jobs/ or MDs/ and end in .md, .txt or .log
//   --text     the line (a newline, control character or more than 2000 characters is refused)
//   --stdin    read the line from stdin instead (no shell quoting at all)
//   --stamp    prefix "YYYY-MM-DD HH:MM " (local time)
//   --create   allow creating the file if it does not exist (default: it must already exist)
//   --dry-run  say what would be written, write nothing
// Exit codes: 0 appended (or dry-run ok), 1 refused or failed (nothing written), 2 usage error.
// Guarantees: never opens a file for writing except with the append flag; never changes existing bytes;
// refuses `..`, absolute paths, drive letters, UNC paths, `:` (Windows streams), symlinks (file or any folder
// on the way) and anything that resolves outside the project. No network, no other process.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// character classes are built from code points (no escape sequences in the source)
const cls = (ranges, flags) => new RegExp("[" + ranges.map(([a, b]) => String.fromCharCode(a) + "-" + String.fromCharCode(b)).join("") + "]", flags);
const CONTROL = cls([[0, 8], [10, 31], [127, 133], [0x2028, 0x2029]], ""); // no g flag: test() must not keep state
const INVISIBLE = cls([[0x200b, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069], [0x061c, 0x061c], [0xfeff, 0xfeff]], "g");
export const MAX_LINE = 2000;
export const MAX_STDIN = 20000;
export const ALLOWED_DIRS = ["jobs", "mds"];
export const ALLOWED_EXT = [".md", ".txt", ".log"];
const MAX_FILE_BYTES = 100 * 1024 * 1024;

export class Refused extends Error { constructor(m) { super(m); this.name = "Refused"; } }
const refuse = (m) => { throw new Refused(m); };

// ---- text ----
export function cleanLine(text, { stamp = false, now = new Date() } = {}) {
  if (typeof text !== "string") refuse("no text given");
  let t = text.normalize("NFC");
  // stdin gives one trailing newline from echo/heredoc: that one is not part of the text
  if (t.endsWith(String.fromCharCode(10))) t = t.slice(0, -1);
  if (t.endsWith(String.fromCharCode(13))) t = t.slice(0, -1);
  if (CONTROL.test(t)) refuse("the text must be ONE line without control characters (newline, escape, NUL and similar are refused; a tab is allowed)");
  // invisible direction/formatting marks are removed, not refused: Arabic text legitimately carries them and they only hide characters
  t = t.replace(INVISIBLE, "");
  t = t.trim();
  if (!t) refuse("the text is empty");
  if (stamp) {
    const p2 = (n) => String(n).padStart(2, "0");
    t = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())} ${t}`;
  }
  if ([...t].length > MAX_LINE) refuse(`the line is longer than ${MAX_LINE} characters`);
  return t;
}

// ---- path ----
// Returns the absolute target path after every check; throws Refused otherwise.
export function resolveTarget(root, rel, { create = false } = {}) {
  if (typeof rel !== "string" || !rel.trim()) refuse("no --file given");
  if (rel.includes("\u0000")) refuse("NUL in the path");
  const r = rel.replace(/\\/g, "/");
  if (r.startsWith("/") || /^[A-Za-z]:/.test(r) || r.startsWith("//")) refuse("the file must be a path relative to the project root");
  if (r.includes(":")) refuse("':' is not allowed in the path (Windows alternate data streams)");
  const parts = r.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) refuse("empty, '.' or '..' parts are not allowed in the path");
  if (parts.some((p) => /[\u0000-\u001f\u007f*?"<>|]/.test(p) || /[. ]$/.test(p))) refuse("the path has characters Windows treats specially (wildcards, trailing dot or space, control characters)");
  if (parts.some((p) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) refuse("reserved device name in the path");
  if (parts.length < 2) refuse("the file must be inside Jobs/ or MDs/, not in the project root");
  if (!ALLOWED_DIRS.includes(parts[0].toLowerCase())) refuse("only files under Jobs/ or MDs/ can be appended to");
  if (!ALLOWED_EXT.includes(path.extname(parts[parts.length - 1]).toLowerCase())) refuse(`only ${ALLOWED_EXT.join(", ")} files can be appended to`);

  let realRoot;
  try { realRoot = fs.realpathSync.native(path.resolve(root)); } catch { refuse("the project root does not exist"); }
  if (!fs.statSync(realRoot).isDirectory()) refuse("the project root is not a folder");

  // walk the folders one by one: none of them may be a symlink / junction, and all must stay inside the root
  let cur = realRoot;
  for (const seg of parts.slice(0, -1)) {
    cur = path.join(cur, seg);
    let st;
    try { st = fs.lstatSync(cur); } catch { refuse(`the folder ${seg} does not exist`); }
    if (st.isSymbolicLink()) refuse(`${seg} is a symbolic link`);
    if (!st.isDirectory()) refuse(`${seg} is not a folder`);
    const real = fs.realpathSync.native(cur);
    if (real !== cur && real.toLowerCase() !== cur.toLowerCase()) refuse(`${seg} resolves outside its place (junction or link)`);
  }
  const target = path.join(cur, parts[parts.length - 1]);
  const inside = path.relative(realRoot, target);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) refuse("the file resolves outside the project");
  let lst = null;
  try { lst = fs.lstatSync(target); } catch { /* does not exist */ }
  if (lst) {
    if (lst.isSymbolicLink()) refuse("the file is a symbolic link");
    if (!lst.isFile()) refuse("the target is not a regular file");
    if (lst.nlink > 1) refuse("the file has more than one hard link");
    if (lst.size > MAX_FILE_BYTES) refuse("the file is larger than 100 MB");
  } else if (!create) refuse("the file does not exist (use --create to create it)");
  return target;
}

// ---- append ----
export function appendLine(target, line, { dryRun = false } = {}) {
  let prefix = "";
  let eol = "\n";
  let size = 0;
  try {
    const fd = fs.openSync(target, "r");
    try {
      size = fs.fstatSync(fd).size;
      if (size > 0) {
        const n = Math.min(size, 4096);
        const buf = Buffer.alloc(n);
        fs.readSync(fd, buf, 0, n, size - n);
        const tail = buf.toString("latin1");
        if (tail.includes("\r\n")) eol = "\r\n";
        if (!tail.endsWith("\n")) prefix = eol; // the last line had no line ending: finish it first
      }
    } finally { fs.closeSync(fd); }
  } catch (e) { if (e && e.code !== "ENOENT") throw e; }
  const data = Buffer.from(prefix + line + eol, "utf8");
  if (dryRun) return { bytes: data.length, wrote: false };
  const fd = fs.openSync(target, "a"); // append only: existing bytes can never be changed
  try { fs.writeSync(fd, data); } finally { fs.closeSync(fd); }
  return { bytes: data.length, wrote: true };
}

export function run({ root, file, text, stamp = false, create = false, dryRun = false, now = new Date() }) {
  const line = cleanLine(text, { stamp, now });
  const target = resolveTarget(root, file, { create });
  const r = appendLine(target, line, { dryRun });
  return { target, line, ...r };
}

// ---- CLI ----
function readStdin() {
  const chunks = [];
  let total = 0;
  const buf = Buffer.alloc(4096);
  for (;;) {
    let n;
    try { n = fs.readSync(0, buf, 0, buf.length, null); } catch (e) { if (e.code === "EOF") break; if (e.code === "EAGAIN") continue; throw e; }
    if (!n) break;
    total += n;
    if (total > MAX_STDIN) refuse(`stdin is larger than ${MAX_STDIN} bytes`);
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function cli(argv) {
  const flags = new Set(["--stdin", "--stamp", "--create", "--dry-run"]);
  const vals = new Set(["--root", "--file", "--text"]);
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags.has(a)) o[a] = true;
    else if (vals.has(a)) { if (i + 1 >= argv.length) { console.error(`usage error: ${a} needs a value`); return 2; } o[a] = argv[++i]; }
    else { console.error(`usage error: unknown argument ${a}\nusage: node joblog.mjs --root DIR --file Jobs/log.md (--text "line" | --stdin) [--stamp] [--create] [--dry-run]`); return 2; }
  }
  if (o["--stdin"] && o["--text"] !== undefined) { console.error("usage error: use --text or --stdin, not both"); return 2; }
  if (!o["--stdin"] && o["--text"] === undefined) { console.error("usage error: give --text or --stdin"); return 2; }
  try {
    const text = o["--stdin"] ? readStdin() : o["--text"];
    const root = o["--root"] || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const r = run({ root, file: o["--file"], text, stamp: !!o["--stamp"], create: !!o["--create"], dryRun: !!o["--dry-run"] });
    console.log(`${r.wrote ? "OK appended" : "OK dry-run, would append"} 1 line (${r.bytes} bytes) to ${String(o["--file"]).replace(/\\/g, "/")}`);
    return 0;
  } catch (e) {
    if (e instanceof Refused) { console.error(`REFUSED: ${e.message}. Nothing was written.`); return 1; }
    console.error(`FAILED: ${e && e.code ? e.code : "could not write"}. Nothing was written or the write was incomplete; check the file.`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(cli(process.argv.slice(2)));
