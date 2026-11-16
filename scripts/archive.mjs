#!/usr/bin/env node
// Archive-before-write helper: copies a project file into that project's archive folder under a dated name,
// so the live file can then be replaced. It never overwrites an archive copy, never changes or deletes the
// source, and checks the copy byte for byte (SHA-256). No network, no other process.
//
// Where a file goes is decided per project by MDs/archive.json (optional):
//   { "first": "a",                                   // first copy of the day: "a" -> name_2026-01-31a.md, then b, c
//                                                     //                        "plain" -> name_2026-01-31.md, then b, c
//     "rules": [ { "from": "MDs/System_Current_MD/", "to": "MDs/System_Previous_MDs/", "byMonth": true },
//                { "from": "MDs/",  "to": "MDs/System_Previous_MDs/" },
//                { "from": "Jobs/", "to": "Jobs/_Archive/" } ] }
// The first rule whose "from" is a prefix of the file's path wins. Without the file, the rules above apply
// with "first": "plain" (the naming of the main skill). A file that matches no rule is refused: add a rule or --to.
//
// CLI: node archive.mjs copy <file> [--root DIR] [--to DIR] [--write]     default: prints the target, copies nothing
//      node archive.mjs init [--root DIR] [--write]                       prints / creates MDs/archive.json (never overwrites)
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

export const CONFIG_REL = ["MDs", "archive.json"];
const slash = (s) => String(s).replace(/\\/g, "/");
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

export const DEFAULT_RULES = [
  { from: "MDs/System_Current_MD/", to: "MDs/System_Previous_MDs/", byMonth: true },
  { from: "MDs/", to: "MDs/System_Previous_MDs/" },
  { from: "Jobs/", to: "Jobs/_Archive/" },
];
export const starterConfig = () => ({ first: "a", rules: DEFAULT_RULES.map((r) => ({ ...r })) });

const dirForm = (s) => slash(s).replace(/^\.?\/+/, "").replace(/\/*$/, "/");

// Missing file -> defaults. A file that exists but is wrong -> throws (never guess where an archive goes).
export function loadArchiveConfig(root) {
  let raw;
  try { raw = fs.readFileSync(path.join(root, ...CONFIG_REL), "utf8"); }
  catch (e) { if (e && e.code === "ENOENT") return { first: "plain", rules: DEFAULT_RULES, fromFile: false }; throw new Error("cannot read MDs/archive.json"); }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  let cfg;
  try { cfg = JSON.parse(raw); } catch { throw new Error("MDs/archive.json is not valid JSON"); }
  const ok = cfg && Array.isArray(cfg.rules) && cfg.rules.length > 0
    && cfg.rules.every((r) => r && typeof r.from === "string" && r.from && typeof r.to === "string" && r.to);
  if (!ok) throw new Error('MDs/archive.json needs "rules": [{ "from": "...", "to": "..." }]');
  if (cfg.first !== undefined && cfg.first !== "a" && cfg.first !== "plain") throw new Error('MDs/archive.json: "first" must be "a" or "plain"');
  return {
    first: cfg.first === "a" ? "a" : "plain",
    rules: cfg.rules.map((r) => ({ from: dirForm(r.from), to: dirForm(r.to), byMonth: r.byMonth === true })),
    fromFile: true,
  };
}

const fold = (s) => (process.platform === "win32" || process.platform === "darwin" ? s.toLowerCase() : s).normalize("NFC");
const inside = (root, p) => { const rel = path.relative(root, p); return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel); };
const RESERVED = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)$/i;
// Refuses a folder name that is a Windows device name (CON, NUL, COM1 ...), also with an extension or trailing dots/spaces.
const checkReserved = (rel) => {
  for (const seg of slash(rel).split("/")) {
    const base = seg.replace(/[. ]+$/, "").split(".")[0].replace(/ +$/, "");
    if (RESERVED.test(base)) throw new Error(`the folder name "${seg}" is a reserved device name`);
    if (/[. ]$/.test(seg)) throw new Error(`the folder name "${seg}" ends in a dot or a space (Windows cannot open it)`);
  }
};
// True only for a real calendar date written YYYY-MM-DD (not 2026-13-45, not 2026-02-30).
export const isRealDate = (s) => {
  const m = String(s).match(/^(\d{4})-(\d\d)-(\d\d)$/);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1000) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};
// Walks the path folder by folder from the project root (the way joblog.mjs does): no component that exists
// may be a symbolic link / junction, and each must resolve to its own place inside the root. Missing tail
// components are fine (they will be created inside a verified parent).
function assertNoLinks(root, target, what) {
  let realRoot;
  try { realRoot = fs.realpathSync.native(root); } catch { throw new Error("the project root does not exist"); }
  const rel = path.relative(root, target);
  let cur = realRoot;
  for (const seg of rel.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, seg);
    let st;
    try { st = fs.lstatSync(cur); } catch (e) { if (e && e.code === "ENOENT") return; throw new Error(`cannot check ${what}: ${seg}`); }
    if (st.isSymbolicLink()) throw new Error(`${what}: "${seg}" is a symbolic link or junction; refusing to follow it`);
    const real = fs.realpathSync.native(cur);
    if (real !== cur && real.toLowerCase() !== cur.toLowerCase()) throw new Error(`${what}: "${seg}" resolves outside its place (junction or link); refusing`);
  }
}
const sha = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
// The opened source handle must be the file that sits at the verified path inside the project: the parent chain has
// no link, the real path is the expected one inside the real root, and handle and path are the same file (device + id).
// Run after the open and again after the copy, so a folder swapped for a junction (and back) in between is caught.
function verifyHandle(root, src, fd) {
  assertNoLinks(root, src, "the source file path");
  let real, realRoot, a, b;
  try { realRoot = fs.realpathSync.native(root); real = fs.realpathSync.native(src); a = fs.fstatSync(fd, { bigint: true }); b = fs.lstatSync(src, { bigint: true }); }
  catch { throw new Error("the source file changed while it was being archived; nothing was archived"); }
  if (!inside(realRoot, real) || fold(real) !== fold(path.join(realRoot, path.relative(root, src))))
    throw new Error("the source file resolves outside its place in the project; nothing was archived");
  if (!a.isFile() || !b.isFile() || a.dev !== b.dev || a.ino !== b.ino)
    throw new Error("the source file was replaced while it was being archived; nothing was archived");
}
// Exclusive publish of a finished temp file under its final name: a hard link fails if the name exists (never overwrites).
function linkExclusive(tmp, dest) {
  try { fs.linkSync(tmp, dest); }
  catch (e) { if (e && e.code === "EEXIST") throw e; fs.copyFileSync(tmp, dest, fs.constants.COPYFILE_EXCL); } // a file system without hard links
}
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

// Next free name for this stem and date. The plain name counts as the first slot, so "plain" and "a"
// archives of the same day never collide and always sort in the order they were made.
export function nextName(destDir, stem, ext, date, first) {
  let names = [];
  try { names = fs.readdirSync(destDir); } catch { /* folder not there yet */ }
  const base = fold(`${stem}_${date}`), e = fold(ext);
  let used = 0; // number of slots taken: plain or "a" = 1, "b" = 2, ...
  for (const n of names.map(fold)) {
    if (!n.startsWith(base) || !n.endsWith(e)) continue;
    const mid = n.slice(base.length, n.length - e.length);
    if (mid === "") used = Math.max(used, 1);
    else if (mid.length === 1 && LETTERS.includes(mid)) used = Math.max(used, LETTERS.indexOf(mid) + 1);
  }
  if (used >= LETTERS.length) throw new Error("more than 26 archive copies of this file today");
  const letter = used === 0 ? (first === "a" ? "a" : "") : LETTERS[used];
  return `${stem}_${date}${letter}${ext}`;
}

// Plans (write=false) or makes (write=true) the archive copy. Returns { src, dest, rel, written }.
// _afterOpen / _afterCopy are test seams: called once right after the source is opened (before it is verified) and once
// after the bytes are copied to the temp file (before the second verification).
export function archiveCopy(root, file, { write = false, to = "", date = today(), _afterOpen = null, _afterCopy = null } = {}) {
  root = path.resolve(root);
  const src = path.resolve(root, file);
  if (!inside(root, src)) throw new Error("the file is outside the project folder");
  assertNoLinks(root, src, "the source file path");
  let st; try { st = fs.lstatSync(src); } catch { throw new Error("file not found: " + slash(path.relative(root, src))); }
  if (!st.isFile()) throw new Error("not a regular file: " + slash(path.relative(root, src)));
  if (!isRealDate(date)) throw new Error("date must be a real calendar date, YYYY-MM-DD");
  const rel = slash(path.relative(root, src));
  const cfg = loadArchiveConfig(root);
  let destRel, byMonth = false;
  if (to && /^[\\/]{2}/.test(String(to))) throw new Error("--to must not start with // or two backslashes (network paths are not allowed)");
  if (to) destRel = dirForm(path.isAbsolute(to) ? path.relative(root, to) : to);
  else {
    if (cfg.rules.some((r) => fold(rel).startsWith(fold(r.to)))) throw new Error("this file is already an archive copy: " + rel);
    const rule = cfg.rules.find((r) => fold(rel).startsWith(fold(r.from)));
    if (!rule) throw new Error(`no archive rule matches ${rel}: add a rule to MDs/archive.json or pass --to <folder>`);
    destRel = rule.to; byMonth = rule.byMonth;
  }
  const destDir = path.join(root, ...destRel.split("/").filter(Boolean), ...(byMonth ? [date.slice(0, 7)] : []));
  if (!inside(root, destDir)) throw new Error("the archive folder is outside the project folder");
  checkReserved(slash(path.relative(root, destDir)));
  assertNoLinks(root, destDir, "the archive folder path");
  const ext = path.extname(src), stem = path.basename(src, ext);
  if (!write) { const dest = path.join(destDir, nextName(destDir, stem, ext, date, cfg.first)); return { src, dest, rel: slash(path.relative(root, dest)), written: false }; }
  // The bytes are read from ONE opened handle that is checked to be the project file, written to a temp name in the
  // archive folder, hashed while copying, and only then published under its final name. A failure leaves nothing behind.
  let fd = -1, tmp = "";
  try {
    fd = fs.openSync(src, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    if (_afterOpen) _afterOpen({ src, destDir });
    verifyHandle(root, src, fd);
    fs.mkdirSync(destDir, { recursive: true });
    assertNoLinks(root, destDir, "the archive folder path");
    tmp = path.join(destDir, `.archive-${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
    const out = fs.openSync(tmp, "wx");
    const h = createHash("sha256"), buf = Buffer.allocUnsafe(1 << 20);
    try {
      for (;;) {
        const n = fs.readSync(fd, buf, 0, buf.length, null);
        if (n === 0) break;
        h.update(buf.subarray(0, n));
        for (let o = 0; o < n;) o += fs.writeSync(out, buf, o, n - o);
      }
    } finally { fs.closeSync(out); }
    if (_afterCopy) _afterCopy({ src, destDir, tmp });
    verifyHandle(root, src, fd);                                         // still the same inside file after the copy
    assertNoLinks(root, destDir, "the archive folder path");
    const digest = h.digest("hex");
    if (sha(tmp) !== digest) throw new Error("the archive copy does not match the bytes read from the source");
    for (let attempt = 0; attempt < 27; attempt++) {
      const dest = path.join(destDir, nextName(destDir, stem, ext, date, cfg.first));
      try { linkExclusive(tmp, dest); }
      catch (e) { if (e && e.code === "EEXIST") continue; throw e; }     // another session took the name: take the next letter
      return { src, dest, rel: slash(path.relative(root, dest)), written: true };
    }
  } finally {
    if (fd >= 0) try { fs.closeSync(fd); } catch { /* already closed */ }
    if (tmp) try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
  throw new Error("could not find a free archive name");
}

const USAGE = "usage: node scripts/archive.mjs copy <file> [--root DIR] [--to DIR] [--date YYYY-MM-DD] [--write] | init [--root DIR] [--write]";
// Strict parsing: a flag that needs a value without one, or an unknown flag (a typo like --wirte), is a usage error.
function parseArgs(args) {
  const VALUE = new Set(["--root", "--date", "--to"]), BOOL = new Set(["--write"]);
  const o = { pos: [], write: false, root: "", date: "", to: "" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUE.has(a)) {
      const v = args[i + 1];
      if (v === undefined || v === "" || v.startsWith("--")) throw Object.assign(new Error(`${a} needs a value. ${USAGE}`), { usage: true });
      o[a.slice(2)] = v; i++;
    } else if (BOOL.has(a)) o.write = true;
    else if (a.startsWith("--")) throw Object.assign(new Error(`unknown option ${a}. ${USAGE}`), { usage: true });
    else o.pos.push(a);
  }
  return o;
}
function cli() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd !== "init" && cmd !== "copy") { console.log(USAGE); return 2; }
  const o = parseArgs(args.slice(1));
  if (cmd === "init" ? o.pos.length !== 0 : o.pos.length !== 1) throw Object.assign(new Error(USAGE), { usage: true });
  if (o.date && !isRealDate(o.date)) throw Object.assign(new Error("--date must be a real calendar date, YYYY-MM-DD"), { usage: true });
  const root = path.resolve(o.root || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const write = o.write;
  if (cmd === "init") {
    const cfgPath = path.join(root, ...CONFIG_REL);
    if (fs.existsSync(cfgPath)) { console.log("OK MDs/archive.json already exists; nothing to do (init never overwrites)."); return 0; }
    const text = JSON.stringify(starterConfig(), null, 2) + "\n";
    if (!write) { console.log(`Suggested MDs/archive.json (not written; add --write to create it):\n${text}`); return 0; }
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, text, { encoding: "utf8", flag: "wx" });
    console.log("OK wrote MDs/archive.json");
    return 0;
  }
  {
    const r = archiveCopy(root, o.pos[0], { write, to: o.to, date: o.date || undefined });
    console.log(r.written ? `OK archived to ${r.rel} (verified). The original was not changed.`
      : `Would archive to ${r.rel} (nothing copied; add --write).`);
    return 0;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(cli()); } catch (e) { console.log("FAIL " + (e && e.message ? e.message : "archive failed")); process.exit(1); }
}
