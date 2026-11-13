import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { projectKey, excludedReason, looksLikeProject, hasMemorySystem, decideOffer, OFFER_TEXT } from "../scripts/onboarding.mjs";

// The SessionStart offer (1.7.0): shown once per project that has no memory system, never in a folder that
// is not a project, never when the answer could not be remembered, and never by writing inside the project.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hook = join(root, "hooks", "session-index.mjs");
const cli = join(root, "scripts", "onboarding.mjs");
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const put = (base, rel, body = "x") => { const p = join(base, ...rel.split("/")); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); return p; };
const HOME = tmp("pms-home-"); // a made-up home folder, so the real one is never looked at
function env(extra = {}) {
  const clean = { ...process.env };
  for (const k of ["PMS_MEMORY_DIR", "CLAUDE_PLUGIN_OPTION_MEMORY_DIR", "CLAUDE_PROJECT_DIR", "CLAUDE_PLUGIN_DATA", "PMS_DATA_DIR", "PMS_SETUP_OFFER"]) delete clean[k];
  return { ...clean, HOME, USERPROFILE: HOME, ...extra };
}
const session = (project, data, extra = {}) =>
  spawnSync(process.execPath, [hook], { encoding: "utf8", cwd: tmp("pms-cwd-"), env: env({ CLAUDE_PROJECT_DIR: project, ...(data ? { CLAUDE_PLUGIN_DATA: data } : {}), ...extra }) });
const ctxOf = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
const run = (args, extra = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: env(extra) });
const tree = (d) => readdirSync(d, { recursive: true }).map(String).sort().join("\n");
const markers = (data) => (existsSync(join(data, "onboarding")) ? readdirSync(join(data, "onboarding")) : []);
const project = () => { const p = tmp("pms-proj-"); put(p, "notes.txt"); put(p, "src/main.py"); return p; };

test("first session in a project without a memory system: one short offer, and nothing is written in the project", () => {
  const p = project(), data = tmp("pms-data-"), before = tree(p);
  const r = session(p, data);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  const ctx = ctxOf(r);
  assert.equal(ctx, OFFER_TEXT);
  assert.ok(ctx.length <= 700, `offer is ${ctx.length} characters`);
  assert.match(ctx, /memory-setup/); assert.match(ctx, /unless the user says yes/); assert.match(ctx, /ONE short sentence/);
  assert.equal(tree(p), before, "the hook must not create anything inside the project");
});

test("the offer is shown once: the second and third session are silent", () => {
  const p = project(), data = tmp("pms-data-");
  assert.match(session(p, data).stdout, /memory-setup/);
  for (let i = 0; i < 2; i++) { const r = session(p, data); assert.equal(r.status, 0); assert.equal(r.stdout, ""); }
  assert.equal(markers(data).length, 1);
});

test("the marker lives in the plugin data folder and holds no path or project name", () => {
  const p = project(), data = tmp("pms-data-");
  session(p, data);
  const [name] = markers(data);
  assert.match(name, /^[0-9a-f]{32}\.json$/);
  const body = readFileSync(join(data, "onboarding", name), "utf8");
  assert.deepEqual(Object.keys(JSON.parse(body)).sort(), ["at", "state", "v"]);
  assert.equal(JSON.parse(body).state, "offered");
  assert.ok(!body.includes(basename(p)));
});

test("declined stays quiet; reset brings the offer back once", () => {
  const p = project(), data = tmp("pms-data-"), before = tree(p);
  const d = run(["decline", "--root", p, "--data", data]);
  assert.equal(d.status, 0); assert.match(d.stdout, /declined/);
  assert.equal(JSON.parse(readFileSync(join(data, "onboarding", markers(data)[0]), "utf8")).state, "declined");
  const verdict = decideOffer({ root: p, env: env({ CLAUDE_PLUGIN_DATA: data }), home: HOME });
  assert.equal(verdict.offer, false); assert.match(verdict.why, /already declined/);
  for (let i = 0; i < 3; i++) assert.equal(session(p, data).stdout, "");
  assert.equal(tree(p), before, "declining writes nothing in the project");
  assert.match(run(["status", "--root", p, "--data", data]).stdout, /recorded answer for this project: declined/);
  assert.equal(run(["reset", "--root", p, "--data", data]).status, 0);
  assert.match(session(p, data).stdout, /memory-setup/);
  assert.equal(session(p, data).stdout, "");
});

test("decline after an offer upgrades the marker instead of adding one", () => {
  const p = project(), data = tmp("pms-data-");
  session(p, data);
  run(["decline", "--root", p, "--data", data]);
  assert.equal(markers(data).length, 1);
  assert.equal(JSON.parse(readFileSync(join(data, "onboarding", markers(data)[0]), "utf8")).state, "declined");
});

test("declining one project does not silence another", () => {
  const a = project(), b = project(), data = tmp("pms-data-");
  run(["decline", "--root", a, "--data", data]);
  assert.equal(session(a, data).stdout, "");
  assert.match(session(b, data).stdout, /memory-setup/);
});

test("off silences every project, on restores the offer", () => {
  const p = project(), data = tmp("pms-data-");
  assert.equal(run(["off", "--data", data]).status, 0);
  assert.equal(session(p, data).stdout, "");
  assert.equal(markers(data).filter((n) => n.endsWith(".json")).length, 0, "no per-project marker is spent while off");
  assert.equal(run(["on", "--data", data]).status, 0);
  assert.match(session(p, data).stdout, /memory-setup/);
});

test("PMS_SETUP_OFFER=off silences the offer without spending it", () => {
  const p = project(), data = tmp("pms-data-");
  assert.equal(session(p, data, { PMS_SETUP_OFFER: "off" }).stdout, "");
  assert.deepEqual(markers(data), []);
});

test("without a plugin data folder there is no offer (a 'no' could not be remembered)", () => {
  const p = project();
  for (let i = 0; i < 2; i++) assert.equal(session(p, "").stdout, "");
  assert.equal(session(p, "", { CLAUDE_PLUGIN_DATA: "relative/path" }).stdout, "", "a relative data path is not trusted");
});

test("a data folder that cannot be written means no offer, not a repeated one", () => {
  const p = project(), data = tmp("pms-data-");
  writeFileSync(join(data, "onboarding"), "a file where the folder should be");
  for (let i = 0; i < 2; i++) { const r = session(p, data); assert.equal(r.status, 0); assert.equal(r.stdout, ""); }
});

test("a damaged marker counts as answered", () => {
  const p = project(), data = tmp("pms-data-");
  put(data, `onboarding/${projectKey(p)}.json`, "{not json");
  assert.equal(session(p, data).stdout, "");
});

// ---- folders that are clearly not projects ----
test("an empty folder, and a folder holding only empty folders or hidden files, are silent", () => {
  const data = tmp("pms-data-");
  const empty = tmp("pms-empty-");
  const dirsOnly = tmp("pms-dirs-"); mkdirSync(join(dirsOnly, "a", "b"), { recursive: true });
  const hidden = tmp("pms-hidden-"); put(hidden, ".DS_Store"); put(hidden, "desktop.ini"); put(hidden, "Thumbs.db");
  for (const d of [empty, dirsOnly, hidden]) assert.equal(session(d, data).stdout, "");
  assert.deepEqual(markers(data), [], "no marker is written for a folder that got no offer");
});

test("the home folder and its standard children are silent; a project folder under home is offered", () => {
  const data = tmp("pms-data-");
  put(HOME, "todo.txt");
  assert.equal(session(HOME, data).stdout, "");
  for (const child of ["Desktop", "Documents", "Downloads", "Dropbox", "OneDrive - Example", ".claude", ".config/tool", "AppData/Local/Thing"]) {
    put(HOME, `${child}/file.txt`);
    assert.equal(session(join(HOME, ...child.split("/")), data).stdout, "", child);
  }
  assert.deepEqual(markers(data), []);
  put(HOME, "Dropbox/My_Project/plan.md");
  assert.match(session(join(HOME, "Dropbox", "My_Project"), data).stdout, /memory-setup/);
});

test("standard folders are recognised whatever their letter case (Linux shows Documents, not documents)", () => {
  for (const d of ["Documents", "DOCUMENTS", "Downloads", "Desktop", "OneDrive", "Dropbox", "AppData"]) {
    assert.notEqual(excludedReason(join(HOME, d), { home: HOME }), "", d);
  }
});

test("Known Folder Move: OneDrive/Documents is a standard folder, a project inside it is not", () => {
  assert.notEqual(excludedReason(join(HOME, "OneDrive", "Documents"), { home: HOME }), "");
  assert.notEqual(excludedReason(join(HOME, "OneDrive - Example", "Desktop"), { home: HOME }), "");
  assert.equal(excludedReason(join(HOME, "OneDrive", "Documents", "My_Project"), { home: HOME }), "");
  assert.equal(excludedReason(join(HOME, "OneDrive", "My_Project"), { home: HOME }), "");
});

test("folders above the home folder and drive roots are never projects", () => {
  assert.equal(excludedReason(dirname(HOME), { home: HOME }), "above the home folder");
  assert.equal(excludedReason(process.platform === "win32" ? "C:\\" : "/", { home: HOME }) !== "", true);
  assert.equal(looksLikeProject(dirname(HOME), { home: HOME }), false);
});

test("system folders are silent", () => {
  if (process.platform === "win32") {
    // ProgramData stands in for the system folders here: Node itself needs the real SystemRoot to start.
    const sys = tmp("pms-sys-"), data = tmp("pms-data-"); put(sys, "Vendor/App/settings.ini"); put(sys, "readme.txt");
    const drop = Object.fromEntries(Object.keys(process.env).filter((k) => /^programdata$/i.test(k)).map((k) => [k, undefined]));
    const sysEnv = { ...drop, ProgramData: sys };
    assert.equal(session(sys, data, sysEnv).stdout, "");
    assert.equal(session(join(sys, "Vendor", "App"), data, sysEnv).stdout, "");
    assert.deepEqual(markers(data), []);
    assert.equal(excludedReason(process.env.SystemRoot || "C:\\Windows", { home: HOME }), "system folder");
    assert.equal(excludedReason(join(process.env.SystemRoot || "C:\\Windows", "System32"), { home: HOME }), "system folder");
  } else {
    for (const d of ["/usr", "/usr/lib", "/etc", "/bin"]) assert.equal(excludedReason(d, { home: HOME }), "system folder", d);
  }
});

test("inside node_modules or .git is not a project", () => {
  const p = project(); put(p, "node_modules/pkg/index.js"); put(p, ".git/hooks/readme.txt");
  assert.equal(looksLikeProject(join(p, "node_modules", "pkg"), { home: HOME }), false);
  assert.equal(looksLikeProject(join(p, ".git", "hooks"), { home: HOME }), false);
  assert.equal(looksLikeProject(p, { home: HOME }), true);
});

// ---- projects that already use the plugin behave exactly as before ----
const SYSTEMS = {
  "MDs/System_Current_MD": (p) => put(p, "MDs/System_Current_MD/01_Project_Summary.md"),
  "MDs/freshness.json": (p) => put(p, "MDs/freshness.json", "{}"),
  "Jobs/state_manifest.json": (p) => put(p, "Jobs/state_manifest.json", "{}"),
  "Persistent_Memory_System": (p) => put(p, "Persistent_Memory_System/MDs/System_Current_MD/00.md"),
  "System_Current_MD in the root": (p) => put(p, "System_Current_MD/00.md"),
};
for (const [name, make] of Object.entries(SYSTEMS)) {
  test(`existing system (${name}): silent as before, no marker`, () => {
    const p = project(), data = tmp("pms-data-"); make(p);
    const r = session(p, data);
    assert.equal(r.status, 0); assert.equal(r.stdout, "");
    assert.deepEqual(markers(data), []);
    assert.equal(hasMemorySystem(p, HOME), true);
  });
}

test("a project with HANDOVER.md gets exactly the hand-over line it got before, with or without a data folder", () => {
  for (const rel of ["HANDOVER.md", "MDs/HANDOVER.md"]) {
    const p = project(), data = tmp("pms-data-"); put(p, rel);
    const withData = session(p, data), without = session(p, "");
    assert.equal(withData.stdout, without.stdout);
    const ctx = ctxOf(withData);
    assert.match(ctx, /^A hand-over file exists: /); assert.doesNotMatch(ctx, /memory-setup/);
    assert.deepEqual(markers(data), []);
  }
});

test("a session opened in a subfolder of a project that has a system is silent", () => {
  const p = project(), data = tmp("pms-data-"); put(p, "MDs/HANDOVER.md"); put(p, "work/deep/file.txt");
  assert.equal(session(join(p, "work", "deep"), data).stdout, "");
  assert.deepEqual(markers(data), []);
});

function memoryFolder() {
  const d = tmp("pms-mem-");
  put(d, "MDs/System_Current_MD/00_Archiving_Rule.md", "# rule\n"); put(d, "MDs/System_Current_MD/01_Project_Summary.md", "# summary\n");
  put(d, "Jobs/2026-01-01_job.md", "STATUS\n");
  return d;
}
test("with a memory folder configured the index is byte-identical with and without a data folder (no offer)", () => {
  const p = project(), data = tmp("pms-data-"), mem = memoryFolder();
  const a = session(p, data, { PMS_MEMORY_DIR: mem }), b = session(p, "", { PMS_MEMORY_DIR: mem });
  assert.equal(a.stdout, b.stdout);
  assert.match(ctxOf(a), /^Persistent Memory System index/); assert.doesNotMatch(ctxOf(a), /memory-setup/);
  assert.deepEqual(markers(data), []);
  const missing = join(tmp("pms-gone-"), "nope");
  assert.equal(session(p, data, { PMS_MEMORY_DIR: missing }).stdout, "", "a configured but missing memory folder stays silent as before");
});

test("PMS_SETUP_OFFER=always adds the offer beside the index, once, under the size cap", () => {
  const p = project(), data = tmp("pms-data-"), mem = memoryFolder();
  const ctx = ctxOf(session(p, data, { PMS_MEMORY_DIR: mem, PMS_SETUP_OFFER: "always" }));
  assert.match(ctx, /^Persistent Memory System index/); assert.match(ctx, /memory-setup/); assert.match(ctx, /Reminder: use the persistent-memory-system skill/);
  assert.ok(ctx.length <= 2400);
  assert.doesNotMatch(ctxOf(session(p, data, { PMS_MEMORY_DIR: mem, PMS_SETUP_OFFER: "always" })), /memory-setup/);
});

// ---- paths ----
test("the project key ignores a trailing slash, and on Windows the case and the slash direction", () => {
  const p = project();
  assert.equal(projectKey(p), projectKey(p + "/"));
  if (process.platform === "win32") {
    assert.equal(projectKey(p), projectKey(p.replace(/\\/g, "/").toUpperCase()));
    assert.equal(projectKey(p), projectKey(p.toLowerCase() + "\\"));
  }
  assert.notEqual(projectKey(p), projectKey(project()));
});

test("a project whose name has Arabic letters and spaces is offered once and declined by path", () => {
  const base = tmp("pms-ar-"), p = join(base, "مشروع تجريبي"), data = tmp("pms-data-");
  put(p, "خطة العمل.md");
  assert.match(session(p, data).stdout, /memory-setup/);
  assert.equal(session(p, data).stdout, "");
  assert.equal(run(["decline", "--root", p, "--data", data]).status, 0);
  assert.equal(markers(data).length, 1);
});

test("decideOffer is pure: asking does not spend the offer", () => {
  const p = project(), data = tmp("pms-data-");
  const e = env({ CLAUDE_PLUGIN_DATA: data });
  for (let i = 0; i < 2; i++) assert.equal(decideOffer({ root: p, env: e, home: HOME }).offer, true);
  assert.deepEqual(markers(data), []);
});

test("the command line without a data folder records nothing and says so", () => {
  const p = project();
  const r = run(["decline", "--root", p]);
  assert.equal(r.status, 2); assert.match(r.stdout, /nothing was recorded/);
  assert.equal(run(["bogus"]).status, 2);
});

test("the hook stays fast and silent on a folder with thousands of entries", () => {
  const p = tmp("pms-big-"), data = tmp("pms-data-");
  for (let i = 0; i < 1500; i++) mkdirSync(join(p, `d${i}`));
  const t = Date.now(); const r = session(p, data);
  assert.equal(r.stdout, ""); assert.ok(Date.now() - t < 8000);
  assert.ok(statSync(p).isDirectory());
});
