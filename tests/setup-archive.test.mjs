import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig, suggestConfig, staleReport } from "../scripts/freshness.mjs";
import { archiveCopy, nextName, loadArchiveConfig, starterConfig } from "../scripts/archive.mjs";
import { plan } from "../scripts/setup.mjs";

// Setup (skill memory-setup) and the archive helper (skill memory-archive), then one made-up project
// taken through the whole path: offer -> consent -> setup -> next session -> end-of-work check -> archive.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = (n) => join(root, "scripts", n);
const hookPath = (n) => join(root, "hooks", n);
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const put = (base, rel, body = "x") => { const p = join(base, ...rel.split("/")); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); return p; };
const read = (base, rel) => readFileSync(join(base, ...rel.split("/")), "utf8");
const HOME = tmp("pms-home-");
function env(extra = {}) {
  const clean = { ...process.env };
  for (const k of ["PMS_MEMORY_DIR", "CLAUDE_PLUGIN_OPTION_MEMORY_DIR", "CLAUDE_PROJECT_DIR", "CLAUDE_PLUGIN_DATA", "PMS_DATA_DIR", "PMS_SETUP_OFFER"]) delete clean[k];
  return { ...clean, HOME, USERPROFILE: HOME, ...extra };
}
const node = (file, args, opts = {}) => spawnSync(process.execPath, [file, ...args], { encoding: "utf8", env: env(opts.env), input: opts.input, cwd: opts.cwd || tmp("pms-cwd-") });
const setup = (p, ...a) => node(script("setup.mjs"), ["init", "--root", p, ...a]);
const archive = (p, ...a) => node(script("archive.mjs"), [...a, "--root", p]);
const tree = (d) => readdirSync(d, { recursive: true }).map((x) => String(x).replace(/\\/g, "/")).sort();
const CREATED = ["Jobs", "Jobs/_Archive", "Jobs/series_log.md", "Jobs/state_manifest.json", "MDs", "MDs/HANDOVER.md",
  "MDs/System_Current_MD", "MDs/System_Previous_MDs", "MDs/archive.json", "MDs/freshness.json"];
const D = "2026-01-31";

// ---------------- setup ----------------
test("setup without --write prints the plan and writes nothing", () => {
  const p = tmp("pms-set-"); put(p, "notes.txt");
  const before = tree(p);
  for (const extra of [[], ["--show"], ["--lang", "ar"], ["--no-freshness"]]) {
    const r = setup(p, ...extra);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /PLAN ONLY: nothing was written/);
    assert.deepEqual(tree(p), before);
  }
  assert.equal((setup(p).stdout.match(/^WOULD CREATE/gm) || []).length, 9);
  assert.match(setup(p, "--show").stdout, /## Start here/);
});

test("setup --write creates the skeleton, and a second run changes nothing", () => {
  const p = tmp("pms-set-"); put(p, "notes.txt");
  const r = setup(p, "--write");
  assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /OK 9 created, 0 kept/);
  assert.deepEqual(tree(p), [...CREATED, "notes.txt"].sort());
  const snapshot = Object.fromEntries(tree(p).filter((f) => f.includes(".")).map((f) => [f, read(p, f)]));
  const again = setup(p, "--write");
  assert.match(again.stdout, /OK 0 created, 9 kept/);
  for (const [f, body] of Object.entries(snapshot)) assert.equal(read(p, f), body, f);
  assert.match(setup(p).stdout, /nothing to do/);
});

test("the files setup writes are valid and agree with the plugin's own readers", () => {
  const p = tmp("pms-set-"); put(p, "notes.txt"); setup(p, "--write");
  const fresh = JSON.parse(read(p, "MDs/freshness.json"));
  assert.deepEqual(fresh, suggestConfig(p), "same config that freshness.mjs init suggests");
  assert.deepEqual(fresh, { state: ["Jobs/state_manifest.json", "MDs/HANDOVER.md"], work: ["Jobs/"] });
  assert.ok(loadConfig(p), "the Stop hook can load it");
  assert.equal(staleReport(p, loadConfig(p)).newer.length, 0, "a fresh setup is not stale");
  assert.equal(node(script("freshness.mjs"), ["check", "--root", p]).status, 0);
  assert.deepEqual(JSON.parse(read(p, "MDs/archive.json")), starterConfig());
  assert.equal(loadArchiveConfig(p).first, "a");
  const manifest = JSON.parse(read(p, "Jobs/state_manifest.json"));
  assert.equal(manifest.version, 1); assert.deepEqual(manifest.live, { verified: {} });
  const handover = read(p, "MDs/HANDOVER.md");
  assert.equal((handover.match(/^## /gm) || []).length, 1, "one block only");
  assert.match(handover, /^## Start here$/m); assert.doesNotMatch(handover, /\{\{/);
  assert.match(read(p, "Jobs/series_log.md"), /Memory system set up/);
});

test("setup never replaces an existing file and respects a hand-over file in the root", () => {
  const p = tmp("pms-set-");
  put(p, "Jobs/series_log.md", "MY OWN LOG\n"); put(p, "HANDOVER.md", "MY HANDOVER\n"); put(p, "MDs/freshness.json", '{"mine":true}');
  const r = setup(p, "--write");
  assert.equal(r.status, 0, r.stdout);
  assert.equal(read(p, "Jobs/series_log.md"), "MY OWN LOG\n");
  assert.equal(read(p, "HANDOVER.md"), "MY HANDOVER\n");
  assert.equal(read(p, "MDs/freshness.json"), '{"mine":true}');
  assert.ok(!existsSync(join(p, "MDs", "HANDOVER.md")), "no second hand-over file");
  assert.match(r.stdout, /KEPT \(exists\) {2}HANDOVER\.md/);
});

test("--no-freshness leaves the Stop hook off for the project", () => {
  const p = tmp("pms-set-"); put(p, "notes.txt"); setup(p, "--write", "--no-freshness");
  assert.ok(!existsSync(join(p, "MDs", "freshness.json")));
  assert.equal(loadConfig(p), null);
  const r = node(hookPath("end-of-work.mjs"), [], { input: "{}", env: { CLAUDE_PROJECT_DIR: p } });
  assert.equal(r.status, 0); assert.equal(r.stdout, "");
});

test("--lang ar writes Arabic text with the same single block", () => {
  const p = tmp("pms-set-"); put(p, "notes.txt"); setup(p, "--write", "--lang", "ar");
  const h = read(p, "MDs/HANDOVER.md");
  assert.match(h, /^## ابدأ من هنا$/m); assert.equal((h.match(/^## /gm) || []).length, 1);
  assert.match(read(p, "Jobs/series_log.md"), /سجل العمل/);
});

test("setup refuses the home folder and a missing folder, and writes nothing", () => {
  put(HOME, "file.txt");
  const before = tree(HOME);
  const r = setup(HOME, "--write");
  assert.equal(r.status, 2); assert.match(r.stdout, /FAIL .*home folder/);
  assert.deepEqual(tree(HOME), before);
  assert.equal(setup(join(tmp("pms-gone-"), "nope"), "--write").status, 2);
  assert.equal(node(script("setup.mjs"), ["bogus"]).status, 2);
});

test("the plan puts the work log before the manifest and the hand-over file last of the three", () => {
  const rels = plan(tmp("pms-set-")).map((i) => i.rel);
  assert.ok(rels.indexOf("Jobs/series_log.md") < rels.indexOf("Jobs/state_manifest.json"));
  assert.ok(rels.indexOf("Jobs/state_manifest.json") < rels.indexOf("MDs/HANDOVER.md"));
});

// ---------------- archive helper ----------------
function withStarter() { const p = tmp("pms-arc-"); put(p, "MDs/archive.json", JSON.stringify(starterConfig())); return p; }

test("archive copy without --write copies nothing", () => {
  const p = withStarter(); put(p, "MDs/HANDOVER.md", "v1");
  const before = tree(p);
  const r = archive(p, "copy", "MDs/HANDOVER.md");
  assert.equal(r.status, 0); assert.match(r.stdout, /Would archive to MDs\/System_Previous_MDs\/HANDOVER_\d{4}-\d\d-\d\da\.md/);
  assert.deepEqual(tree(p), before);
});

test('with "first": "a" same-day copies are a, b, c; each keeps its own bytes and the original is untouched', () => {
  const p = withStarter(); const f = put(p, "Jobs/state_manifest.json", "one");
  const names = [];
  for (const body of ["one", "two", "three"]) {
    writeFileSync(f, body);
    const r = archiveCopy(p, "Jobs/state_manifest.json", { write: true, date: D });
    assert.equal(r.written, true); names.push(r.rel);
    assert.equal(readFileSync(f, "utf8"), body);
  }
  assert.deepEqual(names, ["a", "b", "c"].map((l) => `Jobs/_Archive/state_manifest_${D}${l}.json`));
  assert.deepEqual(names.map((n) => read(p, n)), ["one", "two", "three"]);
});

test("without MDs/archive.json the first copy is plain, then b; memory files go into a month folder", () => {
  const p = tmp("pms-arc-"); put(p, "MDs/System_Current_MD/01_Project_Summary.md", "s1"); put(p, "MDs/HANDOVER.md", "h");
  assert.equal(archiveCopy(p, "MDs/System_Current_MD/01_Project_Summary.md", { write: true, date: D }).rel, `MDs/System_Previous_MDs/2026-01/01_Project_Summary_${D}.md`);
  assert.equal(archiveCopy(p, "MDs/System_Current_MD/01_Project_Summary.md", { write: true, date: D }).rel, `MDs/System_Previous_MDs/2026-01/01_Project_Summary_${D}b.md`);
  assert.equal(archiveCopy(p, "MDs/HANDOVER.md", { write: true, date: D }).rel, `MDs/System_Previous_MDs/HANDOVER_${D}.md`);
  assert.equal(archiveCopy(p, "MDs/HANDOVER.md", { write: true, date: "2026-02-01" }).rel, "MDs/System_Previous_MDs/HANDOVER_2026-02-01.md", "a new day starts again");
});

test("an existing archive copy is never overwritten, whichever naming made it", () => {
  const p = withStarter(); put(p, "Jobs/log.md", "new");
  put(p, `Jobs/_Archive/log_${D}.md`, "OLD PLAIN");
  assert.equal(archiveCopy(p, "Jobs/log.md", { write: true, date: D }).rel, `Jobs/_Archive/log_${D}b.md`);
  put(p, `Jobs/_Archive/log_${D}d.md`, "OLD D");
  assert.equal(archiveCopy(p, "Jobs/log.md", { write: true, date: D }).rel, `Jobs/_Archive/log_${D}e.md`);
  assert.equal(read(p, `Jobs/_Archive/log_${D}.md`), "OLD PLAIN"); assert.equal(read(p, `Jobs/_Archive/log_${D}d.md`), "OLD D");
  assert.equal(nextName(join(p, "nowhere"), "x", ".md", D, "a"), `x_${D}a.md`);
  assert.equal(nextName(join(p, "nowhere"), "x", ".md", D, "plain"), `x_${D}.md`);
});

test("a name that looks similar is not counted as an earlier copy", () => {
  const p = withStarter(); put(p, "Jobs/log.md");
  put(p, `Jobs/_Archive/log_${D}_prelint.md`); put(p, `Jobs/_Archive/log_extra_${D}a.md`); put(p, `Jobs/_Archive/log_${D}a.txt`);
  assert.equal(archiveCopy(p, "Jobs/log.md", { write: true, date: D }).rel, `Jobs/_Archive/log_${D}a.md`);
});

test("archive refuses: a file outside the project, a file with no rule, an archive copy, a folder, a missing file", () => {
  const p = withStarter(); const outside = put(tmp("pms-out-"), "secret.md");
  put(p, "notes.md"); put(p, `Jobs/_Archive/log_${D}a.md`); mkdirSync(join(p, "Jobs", "sub"), { recursive: true });
  const before = tree(p);
  assert.throws(() => archiveCopy(p, outside, { write: true }), /outside the project/);
  assert.throws(() => archiveCopy(p, "../x.md", { write: true }), /outside the project/);
  assert.throws(() => archiveCopy(p, "notes.md", { write: true }), /no archive rule/);
  assert.throws(() => archiveCopy(p, `Jobs/_Archive/log_${D}a.md`, { write: true }), /already an archive copy/);
  assert.throws(() => archiveCopy(p, "Jobs/sub", { write: true }), /not a regular file/);
  assert.throws(() => archiveCopy(p, "Jobs/none.md", { write: true }), /file not found/);
  assert.throws(() => archiveCopy(p, "notes.md", { write: true, to: "../elsewhere" }), /outside the project/);
  assert.deepEqual(tree(p), before);
  assert.equal(archiveCopy(p, "notes.md", { write: true, to: "Old", date: D }).rel, `Old/notes_${D}a.md`, "--to names the folder for a file with no rule");
  const r = archive(p, "copy", "../x.md", "--write");
  assert.equal(r.status, 1); assert.match(r.stdout, /^FAIL /);
});

test("a broken MDs/archive.json stops the copy instead of guessing a place", () => {
  for (const body of ["{not json", '{"rules":[]}', '{"rules":[{"from":"Jobs/"}]}', '{"first":"z","rules":[{"from":"Jobs/","to":"Jobs/_Archive/"}]}']) {
    const p = tmp("pms-arc-"); put(p, "MDs/archive.json", body); put(p, "Jobs/log.md");
    const before = tree(p);
    const r = archive(p, "copy", "Jobs/log.md", "--write");
    assert.equal(r.status, 1, body); assert.match(r.stdout, /^FAIL .*archive\.json/);
    assert.deepEqual(tree(p), before);
  }
  const bom = tmp("pms-arc-"); put(bom, "MDs/archive.json", "﻿" + JSON.stringify(starterConfig())); put(bom, "Jobs/log.md");
  assert.equal(archiveCopy(bom, "Jobs/log.md", { write: true, date: D }).rel, `Jobs/_Archive/log_${D}a.md`, "a BOM is tolerated");
});

test("archive init prints a starter, writes it only with --write, and never overwrites", () => {
  const p = tmp("pms-arc-"); put(p, "notes.txt");
  assert.match(archive(p, "init").stdout, /not written/);
  assert.ok(!existsSync(join(p, "MDs", "archive.json")));
  assert.equal(archive(p, "init", "--write").status, 0);
  assert.deepEqual(JSON.parse(read(p, "MDs/archive.json")), starterConfig());
  put(p, "MDs/archive.json", '{"first":"plain","rules":[{"from":"Jobs/","to":"Old/"}]}');
  assert.match(archive(p, "init", "--write").stdout, /already exists/);
  assert.equal(loadArchiveConfig(p).rules[0].to, "Old/");
});

test("Arabic file names with spaces, and backslash paths on Windows, archive correctly", () => {
  const p = withStarter(); put(p, "Jobs/سجل العمل.md", "محتوى");
  const rel = process.platform === "win32" ? "Jobs\\سجل العمل.md" : "Jobs/سجل العمل.md";
  const r = archiveCopy(p, rel, { write: true, date: D });
  assert.equal(r.rel, `Jobs/_Archive/سجل العمل_${D}a.md`);
  assert.equal(read(p, r.rel), "محتوى");
});

// ---------------- one made-up project, end to end ----------------
// Names only, invented content: the shape of a content project that has work but no memory system.
function fixture() {
  const p = join(tmp("pms-fix-"), "Sample_Series");
  put(p, "CLAUDE.md", "# Sample series\nReply in English.\n");
  put(p, "Episodes/EP01/script_v1.md", "INT. EXAMPLE - DAY\n");
  put(p, "Episodes/EP01/facts.json", '{"facts":[]}');
  put(p, "Episodes/EP02/script_v1.md", "draft\n");
  put(p, "Series_Kit/style_guide.md", "tone: calm\n");
  put(p, "tools/check_script.py", "print('ok')\n");
  return p;
}
const startSession = (p, data) => node(hookPath("session-index.mjs"), [], { env: { CLAUDE_PROJECT_DIR: p, CLAUDE_PLUGIN_DATA: data } });
const stopHook = (p, transcriptPath) => node(hookPath("end-of-work.mjs"), [], { input: JSON.stringify({ transcript_path: transcriptPath }), env: { CLAUDE_PROJECT_DIR: p } });

test("fixture end to end: offer once -> setup after consent -> hand-over line -> end-of-work check -> archive", () => {
  const p = fixture(), data = tmp("pms-data-"), before = tree(p);

  // 1. first session: the offer, and still nothing new in the project
  const s1 = startSession(p, data);
  assert.match(JSON.parse(s1.stdout).hookSpecificOutput.additionalContext, /memory-setup/);
  assert.deepEqual(tree(p), before);
  // the Stop hook is still off here
  assert.equal(stopHook(p, join(p, "missing.jsonl")).stdout, "");

  // 2. the plan (no consent yet) writes nothing; with consent the skeleton appears and the work is untouched
  assert.equal(setup(p).status, 0); assert.deepEqual(tree(p), before);
  assert.match(setup(p, "--write").stdout, /OK 9 created, 0 kept/);
  assert.deepEqual(tree(p), [...before, ...CREATED].sort());
  assert.equal(read(p, "Episodes/EP01/script_v1.md"), "INT. EXAMPLE - DAY\n");
  assert.equal(read(p, "CLAUDE.md"), "# Sample series\nReply in English.\n");
  assert.match(read(p, "MDs/HANDOVER.md"), /^# HANDOVER: Sample_Series /);

  // 3. next session: the hand-over line as in every project that has one, no offer
  const ctx = JSON.parse(startSession(p, data).stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /^A hand-over file exists: MDs.HANDOVER\.md/); assert.doesNotMatch(ctx, /memory-setup/);

  // 4. this session appends to the work log after the state files: the Stop hook blocks and names the file
  const now = Date.now() / 1000;
  for (const f of ["Jobs/state_manifest.json", "MDs/HANDOVER.md"]) utimesSync(join(p, ...f.split("/")), now - 30, now - 30);
  const log = join(p, "Jobs", "series_log.md");
  utimesSync(log, now, now);
  const tdir = tmp("pms-tr-"), tp = join(tdir, "session.jsonl");
  writeFileSync(tp, [
    JSON.stringify({ type: "queue-operation", timestamp: new Date((now - 60) * 1000).toISOString(), content: "hello" }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Edit", input: { file_path: log } }] } }),
  ].join("\n") + "\n");
  const blocked = JSON.parse(stopHook(p, tp).stdout);
  assert.equal(blocked.decision, "block"); assert.match(blocked.reason, /Jobs\/series_log\.md/);

  // 5. archive the two state files (letters a, then b on the same day), update them, and the hook allows
  const a1 = archive(p, "copy", "Jobs/state_manifest.json", "--write");
  assert.match(a1.stdout, /OK archived to Jobs\/_Archive\/state_manifest_\d{4}-\d\d-\d\da\.json \(verified\)/);
  assert.match(archive(p, "copy", "MDs/HANDOVER.md", "--write").stdout, /MDs\/System_Previous_MDs\/HANDOVER_\d{4}-\d\d-\d\da\.md/);
  assert.match(archive(p, "copy", "MDs/HANDOVER.md", "--write").stdout, /HANDOVER_\d{4}-\d\d-\d\db\.md/);
  for (const f of ["Jobs/state_manifest.json", "MDs/HANDOVER.md"]) utimesSync(join(p, ...f.split("/")), now + 10, now + 10);
  assert.equal(stopHook(p, tp).stdout, "", "archive copies are not work files and the state is current again");
  assert.equal(node(script("freshness.mjs"), ["check", "--root", p]).status, 0);
  assert.equal(readdirSync(join(data, "onboarding")).length, 1, "one marker for the whole story");
});

test("fixture: the user declines; later sessions are silent and the project is byte-for-byte unchanged", () => {
  const p = fixture(), data = tmp("pms-data-"), before = tree(p);
  assert.match(startSession(p, data).stdout, /memory-setup/);
  assert.equal(node(script("onboarding.mjs"), ["decline", "--root", p, "--data", data]).status, 0);
  for (let i = 0; i < 3; i++) assert.equal(startSession(p, data).stdout, "");
  assert.deepEqual(tree(p), before);
});

test("fixture: a project that already uses the plugin starts exactly as it did (same output with and without a data folder)", () => {
  const p = join(tmp("pms-fix-"), "Existing_Project"), data = tmp("pms-data-");
  put(p, "CLAUDE.md"); put(p, "MDs/HANDOVER.md", "# HANDOVER\n"); put(p, "MDs/System_Current_MD/01_Project_Summary.md");
  put(p, "MDs/System_Previous_MDs/2026-01/01_Project_Summary_2026-01-05.md"); put(p, "MDs/Templates/checklist.md");
  put(p, "MDs/freshness.json", JSON.stringify({ state: ["MDs/HANDOVER.md", "Jobs/state_manifest.json"], work: ["Jobs/", "MDs/Templates/"] }));
  put(p, "Jobs/state_manifest.json", "{}"); put(p, "Jobs/series_log.md"); put(p, "Jobs/_Archive/series_log_2026-01-05a.md");
  const before = tree(p);
  const withData = startSession(p, data);
  const without = node(hookPath("session-index.mjs"), [], { env: { CLAUDE_PROJECT_DIR: p } });
  assert.equal(withData.stdout, without.stdout);
  assert.doesNotMatch(withData.stdout, /memory-setup/);
  assert.ok(!existsSync(join(data, "onboarding")), "nothing is recorded for a project that has a system");
  assert.deepEqual(tree(p), before);
  assert.match(setup(p).stdout, /KEEP \(exists\) {2}MDs\/freshness\.json/);
});

test("a project name with replacement patterns ($&, $`) is written literally", () => {
  const parent = tmp("pms-dollar-");
  const p = join(parent, "A$&B$`C");
  put(parent, "A$&B$`C/x.txt");
  const r = setup(p, "--write");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(read(p, "MDs/HANDOVER.md").includes("A$&B$`C"));
});
