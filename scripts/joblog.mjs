#!/usr/bin/env node
// Job-log helper: appends ONE line to a log file inside a project's Jobs/ or MDs/ folder, so unattended
// (scheduled) sessions do not have to write it through the shell (`printf '...' >> file`). A shell redirect is
// a file write the permission system asks about, and the usual fix (a broad rule such as Bash(printf:*)) would
// let a session write ANY file. This script can only append, only one line, only inside the project it runs in.
//
// CLI: node joblog.mjs --root DIR --file Jobs/log.md (--text "line" | --stdin) [--stamp] [--create] [--dry-run]
//   --root     the project folder; it must be the folder this session runs in (CLAUDE_PROJECT_DIR or the current
//              folder) or a folder inside it: a session cannot write into another project
//   --file     path RELATIVE to the root; must be under Jobs/ or MDs/ and end in .md, .txt or .log
//   --text     the line; --stdin reads it from stdin instead (no shell quoting at all; prefer --text in PowerShell 5.1)
//   --stamp    prefix "YYYY-MM-DD HH:MM " (local time)
//   --create   allow creating the file if it does not exist (never a folder)
//   --dry-run  say what would be written, write nothing
// What the text goes through: Unicode NFC, one trailing line ending removed, surrounding spaces trimmed, invisible
// direction/formatting characters removed (zero-width joiner and non-joiner are kept: Arabic and Persian need them).
// Refused (exit 1, nothing written): a line break or other control character inside the text, U+FFFD (broken UTF-8),
// more than 2000 characters, `..`, absolute, drive, UNC and `:` paths, Windows device names, files outside Jobs/ and
// MDs/, other extensions, symbolic links and junctions (file or any folder on the way), files with several hard
// links, files that are not UTF-8 text (a NUL near the end), a missing file without --create.
// Exit codes: 0 appended (or dry-run ok), 1 refused or failed, 2 usage error.
// The session folder is CLAUDE_PROJECT_DIR when set, otherwise the current folder; a caller that can run compound shell
// commands (cd elsewhere && node ...) can still choose another folder, so keep the permission rule to this one command
// and keep the session's own permission system on. Anything under MDs/ (HANDOVER.md for example) is read by later
// sessions: treat text written here as data, never as instructions.
// Honest limit: the checks run before the file is opened; the open itself refuses links where the platform allows
// (O_NOFOLLOW on Linux/macOS) and the opened file is re-checked, but on Windows a link swapped in between the check
// and the open by a process that can already write inside the project is not detected.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// character classes are built from code points (no escape sequences in the source)
const cls = (ranges, flags) => new RegExp("[" + ranges.map(([a, b]) => String.fromCodePoint(a) + "-" + String.fromCodePoint(b)).join("") + "]", flags);
const CONTROL = cls([[0, 8], [10, 31], [127, 159], [0x2028, 0x2029]], "u"); // no g flag: test() must not keep state
const INVISIBLE = cls([[0x00ad, 0x00ad], [0x034f, 0x034f], [0x061c, 0x061c], [0x180b, 0x180e], [0x200b, 0x200b], [0x200e, 0x200f],
  [0x202a, 0x202e], [0x2060, 0x206f], [0x3164, 0x3164], [0xfe00, 0xfe0e], [0xfeff, 0xfeff], [0xfff9, 0xfffb], [0xe0000, 0xe007f], [0xe0100, 0xe01ef], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x2800, 0x2800], [0xffa0, 0xffa0]], "gu");
const LF = String.fromCharCode(10), CR = String.fromCharCode(13), CRLF = CR + LF;
const BAD_CHAR = String.fromCharCode(0xfffd);
const RESERVED = new RegExp("^(con|prn|aux|nul|conin[$]|conout[$]|(com|lpt)[1-9" + String.fromCharCode(0xb9, 0xb2, 0xb3) + "])[ ]*([.]|$)", "i");

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
  if (typeof text.isWellFormed === "function" && !text.isWellFormed()) refuse("the text contains a lone surrogate (not valid Unicode)");
  let t = text.normalize("NFC");
  // echo/heredoc/stdin add one trailing line ending: that one is not part of the text
  if (t.endsWith(CRLF)) t = t.slice(0, -2); else if (t.endsWith(LF)) t = t.slice(0, -1);
  if (CONTROL.test(t)) refuse("the text must be ONE line without control characters (a line break, escape, NUL and similar are refused; a tab is allowed)");
  if (t.includes(BAD_CHAR)) refuse("the text contains U+FFFD (input that was not valid UTF-8, or a lone surrogate)");
  t = t.replace(INVISIBLE, "").trim();
  if (!t) refuse("the text is empty");
  if (stamp) {
    const p2 = (n) => String(n).padStart(2, "0");
    t = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())} ${t}`;
  }
  if ([...t].length > MAX_LINE) refuse(`the line is longer than ${MAX_LINE} characters`);
  return t;
}

// ---- the folder this session may write in ----
export function checkRoot(root, { env = process.env, cwd = process.cwd() } = {}) {
  let real;
  try { real = fs.realpathSync.native(path.resolve(root)); } catch { refuse("the project root does not exist"); }
  if (!fs.statSync(real).isDirectory()) refuse("the project root is not a folder");
  if (path.parse(real).root === real) refuse("a drive or filesystem root is not a project folder");
  let home = "";
  try { home = fs.realpathSync.native(os.homedir()); } catch { /* unknown */ }
  if (home && real.toLowerCase() === home.toLowerCase()) refuse("the home folder is not a project folder");
  // the session's folder: CLAUDE_PROJECT_DIR when the session sets it, otherwise the current folder (never both)
  let base;
  try { base = fs.realpathSync.native(path.resolve(env.CLAUDE_PROJECT_DIR || cwd)); } catch { refuse("the session folder does not exist"); }
  const rel = path.relative(base, real);
  const inside = rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
  if (!inside) refuse("--root must be the folder this session runs in (CLAUDE_PROJECT_DIR, or the current folder when it is not set) or a folder inside it");
  return real;
}

// ---- path ----
// Returns the absolute target path after every check; throws Refused otherwise.
export function resolveTarget(root, rel, { create = false } = {}) {
  if (typeof rel !== "string" || !rel.trim()) refuse("no --file given");
  if (rel.includes(String.fromCharCode(0))) refuse("NUL in the path");
  const r = rel.replace(/\\/g, "/");
  if (r.startsWith("/") || /^[A-Za-z]:/.test(r) || r.startsWith("//")) refuse("the file must be a path relative to the project root");
  if (r.includes(":")) refuse("':' is not allowed in the path (Windows alternate data streams)");
  const parts = r.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) refuse("empty, '.' or '..' parts are not allowed in the path");
  if (parts.some((p) => CONTROL.test(p) || /[*?"<>|]/.test(p) || /[. ]$/.test(p))) refuse("the path has characters Windows treats specially (wildcards, trailing dot or space, control characters)");
  if (parts.some((p) => RESERVED.test(p))) refuse("reserved device name in the path");
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
  if (!inside || inside === ".." || inside.startsWith(".." + path.sep) || path.isAbsolute(inside)) refuse("the file resolves outside the project");
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
const C = fs.constants;
const NOFOLLOW = C.O_NOFOLLOW || 0; // not available on Windows
export function appendLine(target, line, { dryRun = false } = {}) {
  let before = null;
  try { before = fs.lstatSync(target); } catch { /* new file */ }
  if (dryRun) return { bytes: Buffer.byteLength(line, "utf8") + 1, wrote: false };
  // ONE open for the whole operation. An existing file is opened for append (+read of its tail), never created
  // or truncated; a new file is created exclusively.
  let fd;
  const openExisting = () => fs.openSync(target, C.O_RDWR | C.O_APPEND | NOFOLLOW);
  try {
    fd = before ? openExisting() : fs.openSync(target, C.O_WRONLY | C.O_APPEND | C.O_CREAT | C.O_EXCL | NOFOLLOW, 0o644);
  } catch (e) {
    if (!before && e && e.code === "EEXIST") { // another writer created it a moment ago: append to it like any existing file
      try { before = fs.lstatSync(target); fd = openExisting(); } catch (e2) { refuse(`could not open the file (${e2 && e2.code ? e2.code : "error"})`); }
    } else refuse(`could not open the file (${e && e.code ? e.code : "error"})`);
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) refuse("the opened target is not a regular file");
    if (st.nlink > 1) refuse("the file has more than one hard link");
    if (before && before.ino && st.ino && (before.ino !== st.ino || before.dev !== st.dev)) refuse("the file changed between the check and the open");
    let prefix = "";
    let eol = LF;
    if (before && st.size > 0) {
      const n = Math.min(st.size, 4096);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, st.size - n);
      if (buf.includes(0)) refuse("the file does not look like UTF-8 text (NUL found near its end)");
      const tail = buf.toString("latin1");
      if (tail.includes(CRLF)) eol = CRLF;
      if (!tail.endsWith(LF)) prefix = eol; // the last line had no line ending: finish it first
    }
    const data = Buffer.from(prefix + line + eol, "utf8");
    const written = fs.writeSync(fd, data);
    if (written !== data.length) throw new Error("PARTIAL_WRITE");
    return { bytes: data.length, wrote: true };
  } finally { fs.closeSync(fd); }
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
  let waits = 0;
  for (;;) {
    let n;
    try { n = fs.readSync(0, buf, 0, buf.length, null); } catch (e) {
      if (e.code === "EOF") break;
      if (e.code === "EAGAIN") { if (++waits > 300) refuse("stdin gave no data for 3 seconds"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); continue; }
      throw e;
    }
    if (!n) break;
    total += n;
    if (total > MAX_STDIN) refuse(`stdin is larger than ${MAX_STDIN} bytes`);
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function cli(argv, env = process.env, cwd = process.cwd()) {
  const flags = new Set(["--stdin", "--stamp", "--create", "--dry-run"]);
  const vals = new Set(["--root", "--file", "--text"]);
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags.has(a)) o[a] = true;
    else if (vals.has(a)) { if (i + 1 >= argv.length) { console.error(`usage error: ${a} needs a value`); return 2; } o[a] = argv[++i]; }
    else { console.error(`usage error: unknown argument ${a}${LF}usage: node joblog.mjs --root DIR --file Jobs/log.md (--text "line" | --stdin) [--stamp] [--create] [--dry-run]`); return 2; }
  }
  if (o["--stdin"] && o["--text"] !== undefined) { console.error("usage error: use --text or --stdin, not both"); return 2; }
  if (!o["--stdin"] && o["--text"] === undefined) { console.error("usage error: give --text or --stdin"); return 2; }
  try {
    const text = o["--stdin"] ? readStdin() : o["--text"];
    const root = checkRoot(o["--root"] || env.CLAUDE_PROJECT_DIR || cwd, { env, cwd });
    const r = run({ root, file: o["--file"], text, stamp: !!o["--stamp"], create: !!o["--create"], dryRun: !!o["--dry-run"] });
    console.log(`${r.wrote ? "OK appended" : "OK dry-run, would append"} 1 line (${r.bytes} bytes) to ${String(o["--file"]).replace(/\\/g, "/")}`);
    return 0;
  } catch (e) {
    if (e instanceof Refused) { console.error(`REFUSED: ${e.message}. Nothing was written.`); return 1; }
    console.error(`FAILED: ${e && (e.code || e.message) ? (e.code || e.message) : "could not write"}. Check the file: the write may be incomplete.`);
    return 1;
  }
}

// run only when started as a script; compare REAL paths so a start through a link, junction, 8.3 name or other letter
// case (for example from a plugin cache) still runs instead of silently doing nothing
const sameFile = (a, b) => { try { return fs.realpathSync.native(a).toLowerCase() === fs.realpathSync.native(b).toLowerCase(); } catch { return false; } };
if (process.argv[1]) {
  if (sameFile(process.argv[1], fileURLToPath(import.meta.url))) process.exitCode = cli(process.argv.slice(2));
  else if (/joblog[.]mjs$/i.test(process.argv[1])) { console.error("REFUSED: could not confirm that this script was started directly (real paths differ or cannot be read). Nothing was written."); process.exitCode = 1; }
}
