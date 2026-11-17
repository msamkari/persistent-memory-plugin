import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, realpathSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { archiveExternal, archiveCopy, EXTERNAL_MANIFEST } from "../scripts/archive.mjs";

// 1.9.0: archive-before-write for files OUTSIDE the project (user-level config such as scheduled tasks). Temp folders only.
const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(here, "scripts", "archive.mjs");
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const put = (base, rel, body = "x") => { const p = join(base, ...rel.split("/")); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); return p; };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const D = "2026-01-31";
const H = (f) => sha(f.replace(/\\/g, "/")).slice(0, 6); // the short hash of the origin path in every archive name
const script2 = join(here, "scripts", "archive-external.mjs");
const cli2 = (args) => spawnSync(process.execPath, [script2, ...args], { encoding: "utf8" });
const cli = (args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
const ARCH = (p) => join(p, "MDs", "System_Previous_MDs", D.slice(0, 7));
const trySymlink = (target, link) => { try { symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir"); return true; } catch { return false; } };

function fixture() {
  const proj = tmp("pms-ext-proj-"), outside = tmp("pms-ext-out-");
  const file = put(outside, "my-task/SKILL.md", "---\nname: my-task\n---\nreal config\n");
  return { proj, outside, file };
}

test("external: a file outside the project is copied under external_<parent>_<name>_<date>a with a sha256 manifest line", () => {
  const { proj, file } = fixture();
  const body = readFileSync(file);
  const r = archiveExternal(proj, file, { write: true, date: D });
  assert.equal(r.written, true);
  assert.equal(r.rel, `MDs/System_Previous_MDs/2026-01/external_my-task_SKILL_${H(file)}_${D}a.md`);
  assert.deepEqual(readFileSync(r.dest), body);
  assert.equal(r.sha256, sha(body));
  const m = readFileSync(join(ARCH(proj), EXTERNAL_MANIFEST), "utf8");
  assert.equal(m, `${sha(body)}  external_my-task_SKILL_${H(file)}_${D}a.md  ${D}  ${file.replace(/\\/g, "/")}\n`);
  assert.deepEqual(readFileSync(file), body, "the source is untouched");
});

test("external: without --write nothing is created", () => {
  const { proj, file } = fixture();
  const r = archiveExternal(proj, file, { date: D });
  assert.equal(r.written, false);
  assert.match(r.rel, /external_my-task_SKILL_[0-9a-f]{6}_2026-01-31a\.md$/);
  assert.equal(existsSync(join(proj, "MDs")), false);
});

test("external: the same day gets letters a, b, c and the manifest keeps one line per copy", () => {
  const { proj, file } = fixture();
  const names = [];
  for (let i = 0; i < 3; i++) { writeFileSync(file, "v" + i); names.push(archiveExternal(proj, file, { write: true, date: D }).rel.split("/").pop()); }
  assert.deepEqual(names, ["a", "b", "c"].map((l) => `external_my-task_SKILL_${H(file)}_${D}${l}.md`));
  const lines = readFileSync(join(ARCH(proj), EXTERNAL_MANIFEST), "utf8").trim().split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1].split("  ")[0], sha("v1"));
  assert.equal(readFileSync(join(ARCH(proj), names[0]), "utf8"), "v0", "an older copy is not overwritten");
});

test("external: two tasks that are both called SKILL.md get different archive names", () => {
  const { proj, outside, file } = fixture();
  const other = put(outside, "other-task/SKILL.md", "other");
  const a = archiveExternal(proj, file, { write: true, date: D }).rel, b = archiveExternal(proj, other, { write: true, date: D }).rel;
  assert.notEqual(a, b);
  assert.match(b, /external_other-task_SKILL_/);
});

test("external: an existing archive name is never overwritten (an occupied a is skipped, its bytes stay)", () => {
  const { proj, file } = fixture();
  const taken = put(ARCH(proj), `external_my-task_SKILL_${H(file)}_${D}a.md`, "OLD COPY");
  const r = archiveExternal(proj, file, { write: true, date: D });
  assert.match(r.rel, /SKILL_[0-9a-f]{6}_2026-01-31b\.md$/);
  assert.equal(readFileSync(taken, "utf8"), "OLD COPY");
  // a failure while the name is taken by a race leaves no temp file behind
  assert.deepEqual(readdirSync(ARCH(proj)).filter((n) => n.endsWith(".tmp")), []);
});

test("external: a symbolic link or junction as the source file, or on its path, is refused and nothing is written", (t) => {
  const { proj, outside, file } = fixture();
  const linkDir = join(outside, "linked");
  if (!trySymlink(dirname(file), linkDir)) return t.skip("links unavailable");
  assert.throws(() => archiveExternal(proj, join(linkDir, "SKILL.md"), { write: true, date: D }), /symbolic link or junction/);
  const fileLink = join(outside, "my-task", "alias.md");
  let ok = true; try { symlinkSync(file, fileLink, "file"); } catch { ok = false; }
  if (ok) assert.throws(() => archiveExternal(proj, fileLink, { write: true, date: D }), /symbolic link or junction/);
  assert.equal(existsSync(join(proj, "MDs")), false);
});

test("external: an archive folder that is a link is refused", (t) => {
  const { proj, file } = fixture();
  const elsewhere = tmp("pms-ext-else-");
  mkdirSync(join(proj, "MDs"), { recursive: true });
  if (!trySymlink(elsewhere, join(proj, "MDs", "System_Previous_MDs"))) return t.skip("links unavailable");
  assert.throws(() => archiveExternal(proj, file, { write: true, date: D }), /symbolic link or junction|resolves outside/);
  assert.deepEqual(readdirSync(elsewhere), []);
});

test("external: relative, network, device, control-character, missing, folder and inside-project paths are refused", () => {
  const { proj, outside, file } = fixture();
  const bad = (p, re) => assert.throws(() => archiveExternal(proj, p, { write: true, date: D }), re, String(p));
  bad("my-task/SKILL.md", /absolute path/);
  bad("//server/share/x.md", /network or device/);
  bad("\\\\.\\COM1", /network or device/);
  bad(file + "\nx", /control characters/);
  bad(join(outside, "nope.md"), /file not found/);
  bad(dirname(file), /not a regular file/);
  bad(put(proj, "MDs/HANDOVER.md"), /inside the project/);
  bad(join(outside, "my-task", "NUL.md"), /reserved device name/);
  assert.equal(existsSync(join(proj, "MDs", "System_Previous_MDs")), false);
});

test("external: a bad date, a --to outside the project or on a network path is refused", () => {
  const { proj, file } = fixture();
  assert.throws(() => archiveExternal(proj, file, { write: true, date: "2026-02-30" }), /real calendar date/);
  assert.throws(() => archiveExternal(proj, file, { write: true, date: D, to: "../escape" }), /outside the project/);
  assert.throws(() => archiveExternal(proj, file, { write: true, date: D, to: "//server/x" }), /network/);
});

test("external: --to chooses the folder; the manifest goes with the copies", () => {
  const { proj, file } = fixture();
  const r = archiveExternal(proj, file, { write: true, date: D, to: "Jobs/_Archive" });
  assert.equal(r.rel, `Jobs/_Archive/external_my-task_SKILL_${H(file)}_${D}a.md`);
  assert.equal(r.manifest, `Jobs/_Archive/${EXTERNAL_MANIFEST}`);
  assert.ok(existsSync(join(proj, r.manifest)));
});

test("external: a manifest that is a folder stops the run before any copy is published", () => {
  const { proj, file } = fixture();
  mkdirSync(join(ARCH(proj), EXTERNAL_MANIFEST), { recursive: true });
  assert.throws(() => archiveExternal(proj, file, { write: true, date: D }), /manifest/);
  assert.deepEqual(readdirSync(ARCH(proj)), [EXTERNAL_MANIFEST]);
});

test("external: a source replaced by another file during the copy is caught and nothing is published", () => {
  const { proj, outside, file } = fixture();
  const swap = () => { rmSync(file); writeFileSync(file, "attacker file"); };
  assert.throws(() => archiveExternal(proj, file, { write: true, date: D, _afterCopy: swap }), /replaced|changed/);
  assert.deepEqual(readdirSync(ARCH(proj)), []);
  void outside;
});

test("existing behaviour: without --external a path outside the project is still refused", () => {
  const { proj, file } = fixture();
  assert.throws(() => archiveCopy(proj, file, { write: true, date: D }), /outside the project folder/);
});

test("external CLI: plan, write, strict usage errors, original unchanged", () => {
  const { proj, file } = fixture();
  const before = statSync(file).mtimeMs, body = readFileSync(file);
  const plan = cli2([file, "--root", proj, "--date", D]);
  assert.equal(plan.status, 0, plan.stdout);
  assert.match(plan.stdout, /^Would archive to MDs\/System_Previous_MDs\/2026-01\/external_my-task_SKILL_[0-9a-f]{6}_2026-01-31a\.md/);
  assert.equal(existsSync(join(proj, "MDs")), false);
  const w = cli2([file, "--root", proj, "--date", D, "--write"]);
  assert.equal(w.status, 0, w.stdout);
  assert.match(w.stdout, new RegExp(`^OK archived to .*verified, sha256 ${sha(body)}; recorded in .*${EXTERNAL_MANIFEST}`));
  assert.deepEqual(readFileSync(file), body); assert.equal(statSync(file).mtimeMs, before);
  for (const args of [[], [file, "extra.md"], ["--external", file], ["rel/path.md"]]) {
    const r = cli2([...args, "--root", proj]);
    assert.equal(r.status, 1, args.join(" "));
    assert.match(r.stdout, /^FAIL /);
  }
});

test("the skills document the external rule (the pinned main skill stays unchanged)", () => {
  const a = readFileSync(join(here, "skills", "memory-archive", "SKILL.md"), "utf8");
  assert.match(a, /Files outside the project/);
  assert.match(a, /archive-external\.sh/);
  assert.match(a, /approval/i);
  assert.match(a, /external_manifest\.txt/);
  const m = readFileSync(join(here, "skills", "memory-continuity", "SKILL.md"), "utf8");
  assert.match(m, /scheduled task/i);
  assert.match(m, /throwaway/i);
});
