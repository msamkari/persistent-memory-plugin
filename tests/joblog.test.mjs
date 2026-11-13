import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, readdirSync, statSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { cleanLine, resolveTarget, appendLine, run, MAX_LINE } from "../scripts/joblog.mjs";

// Strict tests for scripts/joblog.mjs (skill memory-log): append ONE line, only inside Jobs/ or MDs/, never more.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "joblog.mjs");
const C = (n) => String.fromCharCode(n);
const LF = C(10), CR = C(13), BS = C(92);
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const put = (base, rel, body = "") => { const p = join(base, ...rel.split("/")); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); return p; };
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const project = () => { const p = tmp("pms-jl-"); put(p, "Jobs/log.md", "# log" + LF + "- first" + LF); put(p, "MDs/notes.txt", ""); return p; };
const cli = (args, opts = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", input: opts.input, env: { ...process.env, CLAUDE_PROJECT_DIR: "" } });
const refused = (fn, re) => assert.throws(fn, (e) => e && e.name === "Refused" && (!re || re.test(e.message)), String(fn));

// ---------- the happy path and text that breaks shell quoting ----------
test("appends one line and never touches the existing bytes", () => {
  const p = project(); const f = join(p, "Jobs", "log.md");
  const before = readFileSync(f);
  const r = cli(["--root", p, "--file", "Jobs/log.md", "--text", "- second"]);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /OK appended 1 line/);
  const after = readFileSync(f);
  assert.equal(after.subarray(0, before.length).compare(before), 0, "old bytes unchanged");
  assert.equal(after.subarray(before.length).toString("utf8"), "- second" + LF);
});

test("text with brackets, slashes, quotes, dollar signs, backticks, pipes and Arabic is written literally", () => {
  const p = project();
  const nasty = "2026-11-13 15:55 CST - [Claude: مهمة zorcha-reply-after-publish] لا رد مطلوب (13/11) $HOME `x` $(whoami) ; | & > < \"q\" 'q' %s " + BS + "n " + BS + "U";
  const r = cli(["--root", p, "--file", "Jobs/log.md", "--text", nasty]);
  assert.equal(r.status, 0, r.stderr);
  const lines = readFileSync(join(p, "Jobs", "log.md"), "utf8").split(LF);
  assert.equal(lines[lines.length - 2], nasty);
});

test("--stdin carries the same text with no shell quoting at all; one trailing newline is not part of it", () => {
  const p = project();
  const t = "سطر (13/11) 'a' \"b\" $x `y`";
  const r = cli(["--root", p, "--file", "Jobs/log.md", "--stdin"], { input: t + LF });
  assert.equal(r.status, 0, r.stderr);
  const lines = readFileSync(join(p, "Jobs", "log.md"), "utf8").split(LF);
  assert.equal(lines[lines.length - 2], t); assert.equal(lines[lines.length - 1], "");
});

test("--stamp prefixes the local date and time; --dry-run writes nothing", () => {
  const p = project(); const f = join(p, "Jobs", "log.md"); const h = sha(f);
  const d = cli(["--root", p, "--file", "Jobs/log.md", "--text", "x", "--dry-run"]);
  assert.equal(d.status, 0); assert.match(d.stdout, /dry-run/); assert.equal(sha(f), h);
  assert.equal(cli(["--root", p, "--file", "Jobs/log.md", "--text", "x", "--stamp"]).status, 0);
  const last = readFileSync(f, "utf8").trim().split(LF).pop();
  assert.match(last, /^\d{4}-\d\d-\d\d \d\d:\d\d x$/);
});

test("a file without a final newline is finished first; CRLF files stay CRLF", () => {
  const p = project();
  put(p, "Jobs/nonl.md", "a" + LF + "b");
  assert.equal(cli(["--root", p, "--file", "Jobs/nonl.md", "--text", "c"]).status, 0);
  assert.equal(readFileSync(join(p, "Jobs", "nonl.md"), "utf8"), "a" + LF + "b" + LF + "c" + LF);
  put(p, "Jobs/crlf.md", "a" + CR + LF + "b" + CR + LF);
  assert.equal(cli(["--root", p, "--file", "Jobs/crlf.md", "--text", "c"]).status, 0);
  assert.equal(readFileSync(join(p, "Jobs", "crlf.md"), "utf8"), "a" + CR + LF + "b" + CR + LF + "c" + CR + LF);
  put(p, "Jobs/empty.md", "");
  assert.equal(cli(["--root", p, "--file", "Jobs/empty.md", "--text", "c"]).status, 0);
  assert.equal(readFileSync(join(p, "Jobs", "empty.md"), "utf8"), "c" + LF);
});

test("Arabic file and folder names, and spaces, work", () => {
  const p = tmp("pms-jl-"); put(p, "Jobs/سجل العمل.md", "x" + LF);
  assert.equal(cli(["--root", p, "--file", "Jobs/سجل العمل.md", "--text", "ok"]).status, 0);
  assert.equal(cli(["--root", p, "--file", "jobs/سجل العمل.md", "--text", "ok2"]).status, 0, "folder name is case-insensitive");
});

// ---------- text that must be refused ----------
test("newline, carriage return, NUL, escape, other control characters and line separators are refused", () => {
  for (const bad of ["a" + LF + "b", "a" + CR + "b", "a" + C(0) + "b", C(27) + "[31mred", "a" + C(7) + "b", "a" + C(127) + "b", "a" + C(0x85) + "b", "a" + C(0x2028) + "b", "a" + C(0x2029) + "b", "a" + C(11) + "b", "a" + C(12) + "b"]) {
    for (let k = 0; k < 2; k++) refused(() => cleanLine(bad), /ONE line/); // twice: no regex state may leak between calls
  }
  const p = project(); const f = join(p, "Jobs", "log.md"); const h = sha(f);
  assert.equal(spawnSync(process.execPath, [SCRIPT, "--root", p, "--file", "Jobs/log.md", "--text", "a" + LF + "- injected line"], { encoding: "utf8" }).status, 1);
  assert.equal(sha(f), h, "a newline injection wrote nothing");
});

test("empty, blank and over-long text is refused; exactly the maximum is accepted", () => {
  for (const bad of ["", "   ", LF, "\t"]) refused(() => cleanLine(bad), /empty/);
  refused(() => cleanLine("x".repeat(MAX_LINE + 1)), /longer/);
  assert.equal(cleanLine("x".repeat(MAX_LINE)).length, MAX_LINE);
  refused(() => cleanLine(undefined), /no text/);
  refused(() => cleanLine(42), /no text/);
});

test("invisible direction marks are removed (they only hide characters); a tab inside text is kept", () => {
  assert.equal(cleanLine("a" + C(0x202e) + "b" + C(0x200f) + "c" + C(0xfeff)), "abc");
  assert.equal(cleanLine("a" + C(9) + "b"), "a" + C(9) + "b");
});

test("--stdin larger than the limit is refused", () => {
  const p = project(); const f = join(p, "Jobs", "log.md"); const h = sha(f);
  const r = cli(["--root", p, "--file", "Jobs/log.md", "--stdin"], { input: "x".repeat(30000) });
  assert.equal(r.status, 1); assert.equal(sha(f), h);
});

// ---------- paths that must be refused (nothing is written, nothing outside is touched) ----------
test("path traversal, absolute, drive, UNC, stream and special names are all refused", () => {
  const p = project(); const outside = tmp("pms-out-"); put(outside, "x.md", "x");
  for (const d of ["src/x.md", "Other/x.md", "node_modules/x.md", ".git/config", "Jobsx/log.md", "xJobs/log.md"]) put(p, d, "x"); // these folders EXIST: only the allow-list may refuse them
  const reasons = [ // each layer is checked by its own message, so removing one layer cannot hide behind the next
    [["../x.md", "Jobs/../../x.md", "Jobs/../x.md", "Jobs/./log.md", "Jobs//log.md"], /parts are not allowed/],
    [["/etc/passwd", "/Jobs/log.md", "C:/Windows/x.md", "c:x.md", "//server/share/x.md"], /relative to the project root/],
    [["src/x.md", "Other/x.md", "node_modules/x.md", ".git/config", "Jobsx/log.md", "xJobs/log.md"], /only files under Jobs/],
    [["Jobs/log.py", "Jobs/log.json", "Jobs/log", "Jobs/.env"], /only .md, .txt, .log/],
    [["Jobs/log.md:stream", "Jobs/log.md::$DATA"], /':' is not allowed/],
    [["log.md", "CLAUDE.md"], /inside Jobs\/ or MDs\//],
  ];
  for (const [list, re] of reasons) for (const rel of list) refused(() => resolveTarget(p, rel), re);
  const cases = [
    "../x.md", "Jobs/../../x.md", "Jobs/../x.md", "Jobs/./log.md", "Jobs//log.md", "Jobs" + BS + ".." + BS + ".." + BS + "x.md",
    "/etc/passwd", "/Jobs/log.md", "C:/Windows/x.md", "C:" + BS + "x.md", "c:x.md", BS + BS + "server" + BS + "share" + BS + "x.md", "//server/share/x.md",
    "Jobs/log.md:stream", "Jobs/log.md::$DATA", "Jobs/lo*.md", "Jobs/lo?.md", "Jobs/<x>.md", "Jobs/a|b.md", "Jobs/log.md.", "Jobs/log.md ", "Jobs/CON.md", "Jobs/nul.txt", "Jobs/com1.log", "Jobs/lpt3.md",
    "log.md", "CLAUDE.md", "src/x.md", "Jobsx/log.md", "xJobs/log.md", "node_modules/x.md", ".git/config", "Jobs", "MDs", "", "   ",
    "Jobs/log.py", "Jobs/log.json", "Jobs/log", "Jobs/log.md.exe", "MDs/HANDOVER.sh", "Jobs/.env",
    "Jobs/log" + C(0) + ".md", outside.replace(/\\/g, "/"),
  ];
  for (const rel of cases) {
    refused(() => resolveTarget(p, rel), undefined);
    if (rel.includes(C(0))) continue; // the operating system cannot pass a NUL in an argument; the module check above covers it
    const r = spawnSync(process.execPath, [SCRIPT, "--root", p, "--file", rel, "--text", "x"], { encoding: "utf8" });
    assert.equal(r.status, 1, `expected refusal for ${JSON.stringify(rel)}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /REFUSED|FAILED/);
  }
  assert.equal(readFileSync(join(outside, "x.md"), "utf8"), "x");
  assert.equal(readFileSync(join(p, "Jobs", "log.md"), "utf8"), "# log" + LF + "- first" + LF);
});

test("a missing file is refused unless --create; --create works only inside Jobs/ or MDs/ and never overwrites", () => {
  const p = project();
  assert.equal(cli(["--root", p, "--file", "Jobs/new.md", "--text", "x"]).status, 1);
  assert.equal(existsSync(join(p, "Jobs", "new.md")), false);
  assert.equal(cli(["--root", p, "--file", "Jobs/new.md", "--text", "x", "--create"]).status, 0);
  assert.equal(readFileSync(join(p, "Jobs", "new.md"), "utf8"), "x" + LF);
  assert.equal(cli(["--root", p, "--file", "Jobs/new.md", "--text", "y", "--create"]).status, 0);
  assert.equal(readFileSync(join(p, "Jobs", "new.md"), "utf8"), "x" + LF + "y" + LF, "append, never replace");
  assert.equal(cli(["--root", p, "--file", "Jobs/missing_dir/new.md", "--text", "x", "--create"]).status, 1, "no folder is ever created");
  assert.equal(existsSync(join(p, "Jobs", "missing_dir")), false);
  assert.equal(cli(["--root", p, "--file", "Other/new.md", "--text", "x", "--create"]).status, 1);
});

test("the root must exist and be a folder", () => {
  const p = project();
  assert.equal(cli(["--root", join(p, "nope"), "--file", "Jobs/log.md", "--text", "x"]).status, 1);
  assert.equal(cli(["--root", join(p, "Jobs", "log.md"), "--file", "Jobs/log.md", "--text", "x"]).status, 1);
});

test("a target that is a folder, or a file with several hard links, is refused", () => {
  const p = project(); mkdirSync(join(p, "Jobs", "dir.md"));
  refused(() => resolveTarget(p, "Jobs/dir.md"), /not a regular file/);
  let linked = true;
  try { linkSync(join(p, "Jobs", "log.md"), join(p, "Jobs", "alias.md")); } catch { linked = false; }
  if (linked) refused(() => resolveTarget(p, "Jobs/log.md"), /hard link/);
});

test("a symbolic link as the file, or as a folder on the way, is refused (files elsewhere stay untouched)", (t) => {
  const p = project(); const out = tmp("pms-out-"); put(out, "victim.md", "victim" + LF); put(out, "dir/victim2.md", "v2" + LF);
  let ok = true;
  try { symlinkSync(join(out, "victim.md"), join(p, "Jobs", "link.md"), "file"); } catch { ok = false; }
  if (ok) {
    refused(() => resolveTarget(p, "Jobs/link.md"), /symbolic link/);
    assert.equal(cli(["--root", p, "--file", "Jobs/link.md", "--text", "x"]).status, 1);
  }
  let okDir = true;
  try { symlinkSync(join(out, "dir"), join(p, "MDs", "linkdir"), "junction"); } catch { okDir = false; }
  if (okDir) {
    refused(() => resolveTarget(p, "MDs/linkdir/victim2.md"), /symbolic link|outside/);
    assert.equal(cli(["--root", p, "--file", "MDs/linkdir/victim2.md", "--text", "x"]).status, 1);
  }
  if (!ok && !okDir) t.skip("symbolic links are not available here");
  assert.equal(readFileSync(join(out, "victim.md"), "utf8"), "victim" + LF);
  assert.equal(readFileSync(join(out, "dir", "victim2.md"), "utf8"), "v2" + LF);
});

test("if Jobs itself is a link to another folder, nothing is written there", (t) => {
  const p = tmp("pms-jl-"); const out = tmp("pms-out-"); put(out, "log.md", "x" + LF);
  try { symlinkSync(out, join(p, "Jobs"), "junction"); } catch { return t.skip("links not available"); }
  assert.equal(cli(["--root", p, "--file", "Jobs/log.md", "--text", "x"]).status, 1);
  assert.equal(readFileSync(join(out, "log.md"), "utf8"), "x" + LF);
});

// ---------- usage errors and exit codes ----------
test("usage errors exit 2 and write nothing; refusals exit 1; success exits 0", () => {
  const p = project(); const h = sha(join(p, "Jobs", "log.md"));
  for (const args of [[], ["--root", p], ["--root", p, "--file", "Jobs/log.md"], ["--root", p, "--file", "Jobs/log.md", "--text"], ["--root", p, "--file", "Jobs/log.md", "--text", "x", "--stdin"], ["--root", p, "--file", "Jobs/log.md", "--text", "x", "--nope"], ["Jobs/log.md", "x"]]) {
    const r = cli(args, { input: "x" });
    assert.equal(r.status, 2, JSON.stringify(args) + r.stderr);
  }
  assert.equal(sha(join(p, "Jobs", "log.md")), h);
  assert.equal(cli(["--root", p, "--file", "Jobs/log.md", "--text", "ok"]).status, 0);
  assert.equal(cli(["--root", p, "--file", "../x.md", "--text", "ok"]).status, 1);
});

test("CLAUDE_PROJECT_DIR is used when --root is missing", () => {
  const p = project();
  const r = spawnSync(process.execPath, [SCRIPT, "--file", "Jobs/log.md", "--text", "via env"], { encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: p } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(p, "Jobs", "log.md"), "utf8"), /via env/);
});

// ---------- concurrency and the module API ----------
test("20 processes appending at once leave 20 intact lines and the old content untouched", async () => {
  const p = project(); const f = join(p, "Jobs", "log.md"); const before = readFileSync(f);
  const n = 20;
  const codes = await Promise.all(Array.from({ length: n }, (_, i) => new Promise((res) => {
    const c = spawn(process.execPath, [SCRIPT, "--root", p, "--file", "Jobs/log.md", "--text", "line-" + String(i).padStart(2, "0") + " " + "x".repeat(200)]);
    c.on("close", res);
  })));
  assert.deepEqual(codes, Array(n).fill(0));
  const after = readFileSync(f);
  assert.equal(after.subarray(0, before.length).compare(before), 0);
  const lines = after.subarray(before.length).toString("utf8").split(LF).filter(Boolean).sort();
  assert.equal(lines.length, n);
  for (let i = 0; i < n; i++) assert.ok(lines[i].startsWith("line-" + String(i).padStart(2, "0") + " "), lines[i].slice(0, 12));
});

test("module API: run() returns what it wrote and appendLine never opens the file for writing except in append mode", () => {
  const p = project();
  const r = run({ root: p, file: "Jobs/log.md", text: "api", stamp: true, now: new Date(2026, 0, 5, 7, 3) });
  assert.equal(r.line, "2026-01-05 07:03 api"); assert.equal(r.wrote, true);
  const src = readFileSync(SCRIPT, "utf8");
  assert.ok(!/writeFileSync|createWriteStream|renameSync|unlinkSync|rmSync|copyFileSync|truncateSync|ftruncate|appendFileSync/.test(src.replace(/\/\/.*$/gm, "")), "only openSync(a) + writeSync may write");
  assert.ok(!/child_process|node:http|node:https|node:net|fetch\(|process\.spawn|execSync/.test(src), "no network, no other process");
  const opens = [...src.matchAll(/openSync\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.ok(opens.every((o) => /"r"$|"a"$/.test(o)), "files are opened only for reading or appending: " + opens.join(" | "));
});

test("the folder tree of the project is unchanged by refusals (no stray files)", () => {
  const p = project();
  const tree = () => readdirSync(p, { recursive: true }).map(String).sort().join("|");
  const t0 = tree();
  for (const rel of ["../x.md", "Jobs/log.py", "Jobs/a/b/c.md", "Other/x.md", "Jobs/x:y.md"]) cli(["--root", p, "--file", rel, "--text", "x", "--create"]);
  assert.equal(tree(), t0);
  assert.ok(statSync(join(p, "Jobs", "log.md")).size > 0);
});
