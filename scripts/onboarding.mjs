#!/usr/bin/env node
// Onboarding: decides whether the SessionStart hook may OFFER (text only) to set up a memory system
// in the current folder, and remembers the answer per project.
// - Reads only names of entries (never file contents) in the project folder and its parents.
// - Writes ONLY inside the plugin's own data folder (CLAUDE_PLUGIN_DATA): one small marker per project,
//   named by a hash of the folder path, so no project name or path is stored. Never writes in the project.
// - No network, no other process. If there is no data folder, it never offers (it could not remember a "no").
// CLI: node onboarding.mjs status|decline|reset|off|on [--root DIR] [--data DIR]
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const slash = (s) => String(s).replace(/\\/g, "/");
const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";

// One comparable form of a folder path: real path, forward slashes, Unicode NFC, no trailing slash,
// lower case where the file system ignores case. "C:\Proj\" and "c:/proj" are the same project.
export function normRoot(p) {
  let r = path.resolve(String(p));
  try { r = fs.realpathSync.native(r); } catch { /* keep the resolved path */ }
  r = slash(r).normalize("NFC").replace(/\/+$/, "");
  return CASE_INSENSITIVE ? r.toLowerCase() : r;
}
const isInside = (child, parent) => child === parent || child.startsWith(parent + "/");

export function dataDir(env = process.env, explicit = "") {
  const d = explicit || env.CLAUDE_PLUGIN_DATA || env.PMS_DATA_DIR || "";
  return d && path.isAbsolute(d) ? d : "";
}
const stateDir = (data) => path.join(data, "onboarding");
export const projectKey = (root) => createHash("sha256").update(normRoot(root)).digest("hex").slice(0, 32);
const markerPath = (data, root) => path.join(stateDir(data), projectKey(root) + ".json");
const offPath = (data) => path.join(stateDir(data), "_off");
// A second marker exists only after the one reminder (see REMIND_AFTER_DAYS): created with "wx", so one session wins.
const remindPath = (data, root) => path.join(stateDir(data), projectKey(root) + ".2.json");
export const REMIND_AFTER_DAYS = 14;

// "offered" | "declined" | null. A marker that exists but cannot be read counts as "offered": stay quiet.
export function projectState(data, root) {
  let raw;
  try { raw = fs.readFileSync(markerPath(data, root), "utf8"); } catch (e) { return e && e.code === "ENOENT" ? null : "offered"; }
  try { const s = JSON.parse(raw).state; return s === "declined" ? "declined" : "offered"; } catch { return "offered"; }
}
// exclusive=true creates the marker only if it does not exist yet (two sessions starting together: one wins).
export function setProjectState(data, root, state, { exclusive = false } = {}) {
  fs.mkdirSync(stateDir(data), { recursive: true });
  const body = JSON.stringify({ v: 1, state, at: new Date().toISOString().slice(0, 10) }) + "\n";
  fs.writeFileSync(markerPath(data, root), body, { encoding: "utf8", flag: exclusive ? "wx" : "w" });
}
export function clearProjectState(data, root) {
  let cleared = false;
  try { fs.rmSync(markerPath(data, root)); cleared = true; } catch { /* not there */ }
  try { fs.rmSync(remindPath(data, root)); cleared = true; } catch { /* not there */ }
  return cleared;
}
// True when the first offer got no answer ("offered", not "declined"), is at least REMIND_AFTER_DAYS old,
// and the one reminder has not been used yet. An unreadable date means: no reminder.
export function reminderDue(data, root, now = new Date()) {
  try {
    const m = JSON.parse(fs.readFileSync(markerPath(data, root), "utf8"));
    if (m.state !== "offered" || fs.existsSync(remindPath(data, root))) return false;
    const t = Date.parse(String(m.at) + "T00:00:00Z");
    return Number.isFinite(t) && (now.getTime() - t) / 86400000 >= REMIND_AFTER_DAYS;
  } catch { return false; }
}
export const isGloballyOff = (data) => fs.existsSync(offPath(data));
export function setGloballyOff(data, off) {
  if (off) { fs.mkdirSync(stateDir(data), { recursive: true }); fs.writeFileSync(offPath(data), "off\n", "utf8"); }
  else { try { fs.rmSync(offPath(data)); } catch { /* was not off */ } }
}

// ---- does this folder (or a parent) already have a memory system? Names only. ----
const SYSTEM_MARKERS = [
  ["MDs", "System_Current_MD"], ["System_Current_MD"], ["Persistent_Memory_System"],
  ["HANDOVER.md"], ["MDs", "HANDOVER.md"], ["MDs", "freshness.json"], ["Jobs", "state_manifest.json"],
];
const hasMarkerHere = (dir) => SYSTEM_MARKERS.some((m) => fs.existsSync(path.join(dir, ...m)));
export function hasMemorySystem(root, home = os.homedir()) {
  const h = normRoot(home);
  let dir = path.resolve(root);
  for (let i = 0; i < 8; i++) {
    const n = normRoot(dir);
    if (i > 0 && (n === h || isInside(h, n) || n === "" || /^[a-z]:$/i.test(n))) break; // never look at the home folder, above it, or at a drive root
    if (hasMarkerHere(dir)) return true;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return false;
}

// ---- is this folder plausibly a project? Conservative: when unsure, say no (stay quiet). ----
const HOME_CHILDREN = new Set(["desktop", "documents", "downloads", "pictures", "music", "videos", "movies", "public",
  "dropbox", "google drive", "icloud drive", "creative cloud files", "appdata", "library", "applications"]);
const PROJECT_MARKERS = new Set([".git", ".claude", "claude.md", "agents.md", "package.json", "pyproject.toml",
  "cargo.toml", "go.mod", "readme.md", "jobs", "mds"]);
const NOISE_FILES = new Set(["desktop.ini", "thumbs.db"]);
const MAX_ENTRIES = 400;

function systemDirs(env) {
  if (process.platform === "win32") {
    return ["SystemRoot", "windir", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData"]
      .map((k) => env[k]).filter(Boolean).map(normRoot);
  }
  return ["/usr", "/etc", "/bin", "/sbin", "/lib", "/proc", "/sys", "/dev", "/boot", "/System", "/Library", "/Applications"].map(normRoot);
}

export function excludedReason(root, { env = process.env, home = os.homedir() } = {}) {
  const n = normRoot(root), h = normRoot(home);
  if (n === "" || /^[a-z]:$/i.test(n)) return "drive root";
  if (n === h) return "home folder";
  if (isInside(h, n)) return "above the home folder";
  if (n.split("/").some((seg) => seg === "node_modules" || seg === ".git")) return "inside a dependency or git folder";
  if (isInside(n, h)) {
    // Compared in lower case on every platform: "Documents" on Linux is the same standard folder as "documents".
    const segs = n.slice(h.length + 1).split("/");
    const first = segs[0].toLowerCase();
    const second = (segs[1] || "").toLowerCase();
    const syncRoot = (x) => x.startsWith("onedrive") || x === "dropbox" || x === "icloud drive" || x === "google drive";
    if (first.startsWith(".")) return "inside a hidden folder of the home folder";
    if (first === "appdata" || (first === "library" && process.platform === "darwin")) return "inside an application data folder";
    if (segs.length === 1 && (HOME_CHILDREN.has(first) || first.startsWith("onedrive"))) return "a standard home folder, not a project";
    // Known Folder Move: OneDrive\Documents and OneDrive\Desktop are the same standard folders one level down.
    if (segs.length === 2 && syncRoot(first) && HOME_CHILDREN.has(second)) return "a standard home folder, not a project";
  }
  if (systemDirs(env).some((s) => s && isInside(n, s))) return "system folder";
  return "";
}

export function looksLikeProject(root, opts = {}) {
  if (excludedReason(root, opts)) return false;
  let dir;
  try { dir = fs.opendirSync(root); } catch { return false; }
  try {
    for (let i = 0; i < MAX_ENTRIES; i++) {
      const e = dir.readSync();
      if (!e) break;
      const name = e.name.toLowerCase();
      if (PROJECT_MARKERS.has(name)) return true;
      if (e.isFile() && !name.startsWith(".") && !NOISE_FILES.has(name)) return true;
    }
  } catch { return false; } finally { try { dir.closeSync(); } catch { /* already closed */ } }
  return false; // no files at the top level and no marker: not clearly a project
}

export const OFFER_TEXT = "persistent-memory: this folder looks like a project and has no memory system yet "
  + "(no MDs/System_Current_MD, HANDOVER.md or MDs/freshness.json). In your first reply, after answering the user, "
  + "add ONE short sentence in the user's language offering to set it up (skill persistent-memory:memory-setup), and say that a no means it will not be offered again for this folder. "
  + "Do not create or change any file unless the user says yes in chat. If the user says no, follow the decline step of that skill. "
  + "If the user does not react, drop it. This note is shown at most twice per project: now, and once more after 14 days if nobody answered; a no stops it for good.";

// Pure decision (no writes). Returns { offer, why }.
export function decideOffer({ root, env = process.env, home = os.homedir(), memoryDirSet = false } = {}) {
  const mode = String(env.PMS_SETUP_OFFER || "").trim().toLowerCase();
  if (["off", "0", "false", "no"].includes(mode)) return { offer: false, why: "switched off by PMS_SETUP_OFFER" };
  const data = dataDir(env);
  if (!data) return { offer: false, why: "no plugin data folder, so a 'no' could not be remembered" };
  if (memoryDirSet && mode !== "always") return { offer: false, why: "a memory folder is already configured (memory_dir)" };
  if (!root) return { offer: false, why: "no project folder" };
  try {
    if (isGloballyOff(data)) return { offer: false, why: "switched off for every project" };
    if (hasMemorySystem(root, home)) return { offer: false, why: "a memory system already exists here or in a parent folder" };
    const ex = excludedReason(root, { env, home });
    if (ex) return { offer: false, why: ex };
    if (!looksLikeProject(root, { env, home })) return { offer: false, why: "no files or project markers at the top level" };
    const st = projectState(data, root);
    if (st === "offered" && reminderDue(data, root)) return { offer: true, why: `reminder: offered ${REMIND_AFTER_DAYS}+ days ago and nobody answered` };
    if (st) return { offer: false, why: `already ${st} for this project` };
    return { offer: true, why: "first session in a project without a memory system" };
  } catch { return { offer: false, why: "could not check" }; }
}

// Used by the hook: records "offered" FIRST and returns the text only if the marker was written.
// If the marker cannot be written (read-only folder, another session won the race), it returns "".
export function claimOffer(opts = {}) {
  const env = opts.env || process.env;
  if (!decideOffer(opts).offer) return "";
  const data = dataDir(env);
  try {
    if (projectState(data, opts.root) === "offered") {  // the one reminder: its own marker, exclusive
      fs.mkdirSync(stateDir(data), { recursive: true });
      fs.writeFileSync(remindPath(data, opts.root), JSON.stringify({ v: 1, state: "reminded", at: new Date().toISOString().slice(0, 10) }) + "\n", { encoding: "utf8", flag: "wx" });
    } else setProjectState(data, opts.root, "offered", { exclusive: true });
  } catch { return ""; }
  return OFFER_TEXT;
}

function cli() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : ""; };
  const root = path.resolve(opt("--root") || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const data = dataDir(process.env, opt("--data"));
  if (!["status", "decline", "reset", "off", "on"].includes(cmd)) {
    console.log("usage: node scripts/onboarding.mjs status|decline|reset|off|on [--root DIR] [--data DIR]");
    return 2;
  }
  if (!data) {
    console.log("INFO the plugin data folder is not known here (no --data, CLAUDE_PLUGIN_DATA or PMS_DATA_DIR), so nothing was recorded. "
      + "Without it the session hook never offers a setup, so there is nothing to switch off.");
    return cmd === "status" ? 0 : 2;
  }
  if (cmd === "status") {
    const d = decideOffer({ root, env: { ...process.env, CLAUDE_PLUGIN_DATA: data } });
    console.log(`memory system present: ${hasMemorySystem(root) ? "yes" : "no"}`);
    console.log(`recorded answer for this project: ${projectState(data, root) || "none"}`);
    console.log(`offers switched off everywhere: ${isGloballyOff(data) ? "yes" : "no"}`);
    console.log(`would offer at next session start: ${d.offer ? "yes" : "no"} (${d.why})`);
    return 0;
  }
  if (cmd === "decline") { setProjectState(data, root, "declined"); console.log("OK recorded: declined for this project. The setup will not be offered here again. Nothing was written in the project."); return 0; }
  if (cmd === "reset") { console.log(clearProjectState(data, root) ? "OK cleared the recorded answer for this project." : "OK nothing was recorded for this project."); return 0; }
  if (cmd === "off") { setGloballyOff(data, true); console.log("OK the setup will not be offered in any project. Undo with: onboarding.mjs on"); return 0; }
  setGloballyOff(data, false); console.log("OK offers are on again (at most twice per project without a memory system).");
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(cli()); } catch (e) { console.log("FAIL " + (e && e.code ? e.code : "could not record the answer")); process.exit(1); }
}
