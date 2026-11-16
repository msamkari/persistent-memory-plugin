#!/usr/bin/env node
// Project setup for the skill memory-setup: lays down the small skeleton a project needs so the plugin
// (installed once, for the user) can serve it. Nothing is copied from the plugin into the project except
// plain project files and two small config files.
//   init [--root DIR] [--lang en|ar] [--no-freshness] [--show]   prints the plan, writes NOTHING
//   init ... --write                                             creates only what is missing; never overwrites
// Created (if missing): MDs/System_Current_MD/, MDs/System_Previous_MDs/, Jobs/, Jobs/_Archive/,
//   Jobs/series_log.md, Jobs/state_manifest.json, MDs/HANDOVER.md (one "Start here" block),
//   MDs/archive.json (where archive copies go), MDs/freshness.json (turns on the end-of-work Stop hook
//   for this project; leave it out with --no-freshness).
// The memory files themselves (00_, 01_, ...) are written by the skill persistent-memory-system, not here.
// No network, no other process.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { suggestConfig, CONFIG_REL as FRESHNESS_REL } from "./freshness.mjs";
import { starterConfig, CONFIG_REL as ARCHIVE_REL } from "./archive.mjs";
import { excludedReason, normRoot } from "./onboarding.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(here, "..", "skills", "memory-setup", "templates");
const isFile = (root, rel) => { try { return fs.statSync(path.join(root, ...rel.split("/"))).isFile(); } catch { return false; } };
const isDir = (root, rel) => { try { return fs.statSync(path.join(root, ...rel.split("/"))).isDirectory(); } catch { return false; } };
const exists = (root, rel) => fs.existsSync(path.join(root, ...rel.split("/")));
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const json = (o) => JSON.stringify(o, null, 2) + "\n";

function handoverText(lang, project, date) {
  const name = lang === "ar" ? "HANDOVER.start.ar.md" : "HANDOVER.start.md";
  return fs.readFileSync(path.join(TEMPLATES, name), "utf8").replace(/\r\n/g, "\n")
    .replaceAll("{{project}}", () => project).replaceAll("{{date}}", () => date);
}
function logText(lang, project, date) {
  return lang === "ar"
    ? `# سجل العمل: ${project}\nسطر لكل عمل، الأحدث في الآخر: \`YYYY-MM-DD | ما تم | الملفات | التالي\`.\n\n${date} | تجهيز نظام الذاكرة (إضافة persistent-memory) | MDs/HANDOVER.md, Jobs/state_manifest.json | املأ «التركيز الحالي» في MDs/HANDOVER.md\n`
    : `# Work log: ${project}\nOne line per job, newest last: \`YYYY-MM-DD | what was done | files | next\`.\n\n${date} | Memory system set up (persistent-memory plugin) | MDs/HANDOVER.md, Jobs/state_manifest.json | fill in "Current focus" in MDs/HANDOVER.md\n`;
}

// The plan: ordered list of { rel, kind, action: "create" | "keep", text? }.
// Order matters for files: work log first, manifest next, hand-over last (the end-of-work check compares file times).
export function plan(root, { lang = "en", freshness = true, date = today() } = {}) {
  root = path.resolve(root);
  const project = path.basename(root);
  const items = [];
  const dir = (rel) => items.push({ rel, kind: "dir", action: isDir(root, rel) ? "keep" : "create" });
  const file = (rel, text) => items.push({ rel, kind: "file", action: exists(root, rel) ? "keep" : "create", text });
  for (const d of ["MDs/System_Current_MD", "MDs/System_Previous_MDs", "Jobs", "Jobs/_Archive"]) dir(d);
  file("Jobs/series_log.md", logText(lang, project, date));
  file("Jobs/state_manifest.json", json({ version: 1, project, updated: date, state: { focus: "", next: "" }, live: { verified: {} } }));
  const handover = isFile(root, "HANDOVER.md") ? "HANDOVER.md" : "MDs/HANDOVER.md"; // a hand-over file in the root is respected
  file(handover, handoverText(lang, project, date));
  file(ARCHIVE_REL.join("/"), json(starterConfig()));
  if (freshness) {
    const work = ["Jobs/", ...(isDir(root, "MDs/Templates") ? ["MDs/Templates/"] : [])];
    file(FRESHNESS_REL.join("/"), json({ state: ["Jobs/state_manifest.json", handover], work }));
  }
  return items;
}

// Nothing is created through a link: every component of every path that would be created is looked at with lstat
// (not exists(), which is false for a dangling link). A link anywhere on the way, or at the file itself, is refused
// BEFORE anything is created, so a refusal leaves no half-made tree. Returns the list of problems (empty = fine).
export function linkProblems(root, items) {
  root = path.resolve(root);
  const bad = [];
  for (const it of items) {
    if (it.action !== "create") continue;
    let cur = root;
    for (const seg of it.rel.split("/").filter(Boolean)) {
      cur = path.join(cur, seg);
      let st;
      try { st = fs.lstatSync(cur); } catch (e) { if (e && e.code === "ENOENT") break; bad.push(`${it.rel}: cannot check ${seg}`); break; }
      if (st.isSymbolicLink()) { bad.push(`${it.rel}: "${seg}" is a symbolic link or junction`); break; }
    }
  }
  return bad;
}
const refuse = (bad) => Object.assign(new Error(`refusing to create anything through a link (${bad.slice(0, 3).join("; ")}). Nothing was created.`), { refusal: true });

// Creates what the plan marks "create". Every file is written with the exclusive flag, so a file that
// appeared in the meantime is kept, never replaced. Returns the items with action "created" | "kept".
export function apply(root, opts = {}) {
  root = path.resolve(root);
  const done = [];
  const items = plan(root, opts);
  const bad = linkProblems(root, items);
  if (bad.length) throw refuse(bad);
  for (const it of items) {
    const p = path.join(root, ...it.rel.split("/"));
    if (it.action === "keep") { done.push({ ...it, action: "kept" }); continue; }
    if (it.kind === "dir") { fs.mkdirSync(p, { recursive: true }); done.push({ ...it, action: "created" }); continue; }
    let text = it.text;
    if (it.rel === FRESHNESS_REL.join("/")) { const s = suggestConfig(root); if (s) text = json(s); } // same rule as `freshness.mjs init`
    fs.mkdirSync(path.dirname(p), { recursive: true });
    try { fs.writeFileSync(p, text, { encoding: "utf8", flag: "wx" }); done.push({ ...it, action: "created" }); }
    catch (e) { if (e && e.code === "EEXIST") done.push({ ...it, action: "kept" }); else throw e; }
  }
  return done;
}

// The account's real home folder, from the operating system and not from USERPROFILE / HOME.
export function realHomeDir() { try { return os.userInfo().homedir; } catch { return ""; } }

// Runs the command; a refusal or a file-system error becomes one "FAIL ..." line and exit code 1.
export function cli(args = process.argv.slice(2), opts = {}) {
  try { return run(args, opts); }
  catch (e) { console.log("FAIL " + (e && e.refusal ? e.message : e && e.code ? e.code : "setup failed")); return 1; }
}
function run(args, { realHome } = {}) {
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : ""; };
  if (args[0] !== "init") {
    console.log("usage: node scripts/setup.mjs init [--root DIR] [--lang en|ar] [--no-freshness] [--show] [--write]");
    return 2;
  }
  const root = path.resolve(opt("--root") || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!isDir(root, ".")) { console.log("FAIL the project folder does not exist"); return 2; }
  // The "is this a project folder" guards must not depend on an environment variable alone: the home folder comes from
  // the operating system, and when USERPROFILE / HOME names a different folder the run is refused. (realHome is the test seam.)
  const home = realHome || realHomeDir();
  if (!realHome) {
    let envHome = ""; try { envHome = os.homedir(); } catch { /* unknown */ } // follows USERPROFILE / HOME, unlike os.userInfo()
    if (!home) { console.log("FAIL cannot tell which folder is the home folder; refusing to set up a project"); return 2; }
    if (envHome && normRoot(envHome) !== normRoot(home)) { console.log("FAIL the home folder variable (USERPROFILE / HOME) names a different folder than the account's real home folder; refusing to guess which folders are protected"); return 2; }
  }
  const ex = excludedReason(root, { home });
  if (ex) { console.log(`FAIL this folder is not set up as a project (${ex}). Choose the project's own folder with --root.`); return 2; }
  const opts = { lang: opt("--lang") === "ar" ? "ar" : "en", freshness: !args.includes("--no-freshness") };
  const write = args.includes("--write");
  let items;
  if (write) items = apply(root, opts);
  else { items = plan(root, opts); const bad = linkProblems(root, items); if (bad.length) throw refuse(bad); }
  const label = { create: "WOULD CREATE", keep: "KEEP (exists)", created: "CREATED", kept: "KEPT (exists)" };
  for (const it of items) console.log(`${label[it.action]}  ${it.rel}${it.kind === "dir" ? "/" : ""}`);
  if (!write && args.includes("--show")) for (const it of items) if (it.kind === "file" && it.action === "create") console.log(`\n----- ${it.rel} -----\n${it.text}`);
  const n = items.filter((i) => i.action === "create" || i.action === "created").length;
  if (write) console.log(`OK ${n} created, ${items.length - n} kept. No existing file was changed.`);
  else console.log(n ? `PLAN ONLY: nothing was written. ${n} item(s) would be created; run again with --write after the user agrees.` : "OK nothing to do: everything is already there.");
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(cli());
}
