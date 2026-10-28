#!/usr/bin/env node
// continuity-inventory.mjs: compares what is on disk with what a project says should be there.
// TEMPLATE: copy it into your project (for example MDs/Templates/), fill the CONFIG section below, run it.
// Not wired into any hook. Needs only Node 18+. No network. Writes only its own report and manifest.
//
// Usage (from anywhere; the root is the current folder unless you pass --root):
//   node continuity-inventory.mjs                 check disk against the manifest
//   node continuity-inventory.mjs --init          rebuild the manifest from the disk as it is NOW
//   node continuity-inventory.mjs --root DIR      project root (default: current folder)
//   node continuity-inventory.mjs --config FILE   JSON file whose keys replace the CONFIG keys below
// Exit code: 0 all checks pass, 1 at least one check failed, 2 usage or setup error.
//
// Manual sections: manifest.links and manifest.live are edited BY HAND. --init keeps them but never fills
// them in. Companions are checked by name only (use {version} in their pattern to tie them to the version).
//
// WARNING: --init accepts whatever is on disk as correct, even a mistake. Run it only after a manual
// check, and prove the script can fail (see mutation-testing.md): a pass right after --init proves nothing.
//
// What it checks, disk only:
//   1. Each deliverable: the current file exists, it is the ONLY versioned file of its kind outside the
//      archive folder, no FINAL-style name, companions exist, SHA-256 and size match the manifest.
//   2. Required files exist and are not empty.
//   3. Cross references: a file mentions what it must (the current file names, a STATUS heading, links).
//   4. Live state of external platforms: read from the manifest only, each with its own verification date;
//      older than maxLiveAgeDays is a failure (the script cannot see the platform, a human or tool must).
//   5. Entry points: HANDOVER exists and CLAUDE.md (and optionally the assistant memory index) points to it.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

// ============================ CONFIG: edit this section ============================
const CONFIG = {
  // Where the script keeps its state (relative to the project root).
  manifest: "Jobs/state_manifest.json",
  report: "Jobs/state_report.md",

  // Versioned deliverables. Tokens {stem} {version} {ext} may be used in "companions" and in mentions.
  // The current file is <stem>_<version>.<ext>, inside "dir"; older versions belong in the archive folder.
  deliverables: [
    // { key: "report-main", dir: "Deliverables/Main", stem: "main-report", version: "v2", ext: "pdf",
    //   companions: ["{stem}_cover_{version}.jpg"] },
  ],
  archiveDir: "_archive",            // folder name that holds old versions (ignored by the single-current check)
  forbiddenNamePart: "FINAL",        // case-insensitive; such a name outside the archive is a failure

  // Files that must exist and be non-empty (paths relative to the root).
  requiredFiles: [
    // "Deliverables/Main/script.md",
  ],

  // Cross references. mustContain entries are plain strings, or tokens:
  //   "{current:<key>}"  replaced by the current file name of that deliverable
  //   "{link:<name>}"    replaced by the URL stored under manifest.links.<name> (query string ignored)
  mentions: [
    // { file: "Jobs/active-job.md", mustContain: ["## STATUS", "{current:report-main}"] },
  ],

  // Live state of things the disk cannot show (platforms, schedules). Stored in manifest.live.verified as
  //   { "<platform>": { "at": "2026-10-28T09:00:00", "how": "what was checked and with which tool" } }
  // A time without a zone is read as local time. A date in the future fails.
  maxLiveAgeDays: 3,
  requireLive: false,                // true: failure when no platform has a verification date

  // Entry points: files that must exist and contain a text. "~/" means your home folder.
  entryPoints: [
    { file: "MDs/HANDOVER.md" },
    { file: "CLAUDE.md", mustContain: "HANDOVER" },
    // { file: "~/.claude/projects/<project-folder>/memory/MEMORY.md", mustContain: "HANDOVER" },
  ],
};
// ===================================================================================

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

function fail(msg) { console.error(msg); process.exit(2); }

if (flag("--help") || flag("-h")) {
  console.log("Usage: node continuity-inventory.mjs [--init] [--root DIR] [--config FILE.json]");
  process.exit(0);
}

const ROOT = resolve(opt("--root") ?? process.cwd());
if (!existsSync(ROOT) || !statSync(ROOT).isDirectory()) fail(`root is not a folder: ${ROOT}`);
const cfgFile = opt("--config");
if (cfgFile) {
  try { Object.assign(CONFIG, JSON.parse(readText(resolve(cfgFile)))); }
  catch (e) { fail(`cannot read config ${cfgFile}: ${e.message}`); }
}

// Reads text; strips a UTF-8 BOM (Windows editors add one and it breaks JSON.parse and exact matches).
function readText(p) {
  try { return readFileSync(p, "utf8").replace(/^﻿/, ""); } catch { return ""; }
}
const abs = (rel) => (rel.startsWith("~/") ? join(homedir(), rel.slice(2)) : resolve(ROOT, rel));
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const fill = (s, d) => s.replaceAll("{stem}", d.stem).replaceAll("{version}", d.version).replaceAll("{ext}", d.ext);
const currentName = (d) => `${d.stem}_${d.version}.${d.ext}`;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function scan() {
  const out = { generated: new Date().toISOString().slice(0, 19), items: {} };
  for (const d of CONFIG.deliverables) {
    const dir = abs(d.dir);
    const p = join(dir, currentName(d));
    const item = { dir: d.dir, current: currentName(d), files: existsSync(dir) ? readdirSync(dir).sort() : [] };
    if (isFile(p)) { item.sha256 = sha256(p); item.size = statSync(p).size; }
    out.items[d.key] = item;
  }
  return out;
}

function check(manifest) {
  const res = [];
  const add = (ok, name, detail = "") => res.push({ ok: Boolean(ok), name, detail });
  const now = scan();
  const forbidden = CONFIG.forbiddenNamePart.toLowerCase();   // matched as a whole word: finalize does not trigger it
  if (CONFIG.deliverables.length === 0 && CONFIG.requiredFiles.length === 0) add(false, "nothing configured: deliverables and requiredFiles are both empty", "fill the CONFIG section");

  for (const d of CONFIG.deliverables) {
    const cur = currentName(d), n = now.items[d.key], m = manifest.items?.[d.key];
    add(n.sha256 !== undefined, `${d.key}: current file ${cur} exists`);
    const re = new RegExp(`^${escapeRe(d.stem)}_v\\d+\\.${escapeRe(d.ext)}$`);
    const versioned = n.files.filter((f) => re.test(f));
    add(versioned.length === 1 && versioned[0] === cur, `${d.key}: only one versioned file outside ${CONFIG.archiveDir}`, `found: ${JSON.stringify(versioned)}`);
    add(!n.files.some((f) => new RegExp(`(^|[^a-z0-9])${escapeRe(forbidden)}([^a-z0-9]|$)`, "i").test(f)), `${d.key}: no "${CONFIG.forbiddenNamePart}" name outside ${CONFIG.archiveDir}`);
    for (const c of d.companions ?? []) add(isFile(join(abs(d.dir), fill(c, d))), `${d.key}: companion ${fill(c, d)}`);
    if (!m) add(false, `${d.key}: not in the manifest`, "run --init after a manual check");
    else {
      add(n.sha256 !== undefined && n.sha256 === m.sha256, `${d.key}: SHA-256 matches the manifest`);
      add(n.size === m.size, `${d.key}: size ${n.size} (manifest ${m.size})`);
      add(m.current === cur, `${d.key}: manifest names the same current file`, `manifest: ${m.current}`);
    }
  }

  for (const f of CONFIG.requiredFiles) {
    add(isFile(abs(f)) && statSync(abs(f)).size > 0, `required file ${f}`);
  }

  for (const mt of CONFIG.mentions) {
    const text = readText(abs(mt.file));
    add(text.length > 0, `${mt.file} is readable and not empty`);
    for (let want of mt.mustContain ?? []) {
      let shown = want;
      want = want.replace(/\{current:([^}]+)\}/g, (_, k) => {
        const d = CONFIG.deliverables.find((x) => x.key === k);
        return d ? currentName(d) : `{unknown deliverable ${k}}`;
      }).replace(/\{link:([^}]+)\}/g, (_, k) => (manifest.links?.[k] ?? `{no link ${k} in manifest}`).split("?")[0]);
      add(text.includes(want), `${mt.file} contains ${shown}`);
    }
  }

  const verified = manifest.live?.verified ?? {};
  for (const [plat, info] of Object.entries(verified)) {
    const t = Date.parse(info?.at);
    const age = Number.isNaN(t) ? Infinity : (Date.now() - t) / 86400000;
    add(age >= -0.01 && age <= CONFIG.maxLiveAgeDays, `live state (${plat}) verified within ${CONFIG.maxLiveAgeDays} days (not in the future)`, `last: ${info?.at} ${info?.how ?? ""}`);
  }
  if (CONFIG.requireLive && Object.keys(verified).length === 0) add(false, "live state: no per-platform verification dates");

  for (const e of CONFIG.entryPoints) {
    const p = abs(e.file);
    add(isFile(p), `entry point ${e.file} exists`);
    if (e.mustContain) add(readText(p).includes(e.mustContain), `entry point ${e.file} contains ${e.mustContain}`);
  }
  return res;
}

const manifestPath = abs(CONFIG.manifest), reportPath = abs(CONFIG.report);

if (flag("--init")) {
  let old = {};
  if (existsSync(manifestPath)) { try { old = JSON.parse(readText(manifestPath)); } catch { fail(`manifest exists but is not valid JSON: ${manifestPath}`); } }
  const st = scan();
  for (const k of ["links", "live"]) if (old[k]) st[k] = old[k];   // keep human-entered sections
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(st, null, 1) + "\n");
  console.log(`manifest written: ${manifestPath} (accepts the disk as it is; check it by hand)`);
  process.exit(0);
}

if (!existsSync(manifestPath)) fail(`manifest missing: ${manifestPath}\nRun with --init once, after checking the disk by hand.`);
let manifest;
try { manifest = JSON.parse(readText(manifestPath)); } catch (e) { fail(`manifest is not valid JSON: ${e.message}`); }

const res = check(manifest);
const bad = res.filter((r) => !r.ok);
const head = `${bad.length ? "FAIL" : "PASS"}: ${res.length - bad.length} of ${res.length} checks`;
const lines = [`# Continuity report ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, head, ""];
if (bad.length) lines.push("## Differences", ...bad.map((r) => `- FAIL ${r.name}${r.detail ? ` (${r.detail})` : ""}`), "");
lines.push("## All checks", ...res.map((r) => `- ${r.ok ? "PASS" : "FAIL"} ${r.name}`));
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, lines.join("\n") + "\n");
console.log(head);
for (const r of bad) console.log(`FAIL: ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
process.exit(bad.length ? 1 : 0);
