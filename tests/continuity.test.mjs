import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = path.join(root, "skills", "memory-continuity");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");

// SHA-256 of skills/persistent-memory-system/SKILL.md with LF line endings (identical to the published skill v8.1).
// Any edit to that file must be deliberate: update this value in the same commit and say why.
const MAIN_SKILL_SHA256 = "8b0916c90966fb47f8af29e5f374c00d1f4f0b3d731c6e64c0ff7d23456af564";

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, "frontmatter block missing");
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-z-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

test("memory-continuity skill exists with valid frontmatter", () => {
  const fm = frontmatter(read("skills", "memory-continuity", "SKILL.md"));
  assert.equal(fm.name, "memory-continuity");
  assert.ok(fm.description && fm.description.length > 60 && fm.description.length < 1024, "description length");
  assert.match(fm.description, /Use when/);
  assert.match(fm.description, /Not for/);
  for (const phrase of ["handover", "cold-start"]) assert.ok(fm.description.toLowerCase().includes(phrase), `description lacks ${phrase}`);
});

test("description does not use the main skill's activation phrases", () => {
  const d = frontmatter(read("skills", "memory-continuity", "SKILL.md")).description.toLowerCase();
  for (const phrase of ["persistent memory", "remember my project", "re-explain", "log our decisions"]) {
    assert.ok(!d.includes(phrase), `description must not contain "${phrase}"`);
  }
});

test("all templates and guides exist and are not empty", () => {
  for (const f of ["templates/HANDOVER.md", "templates/CLAUDE.pointer.md", "templates/continuity-inventory.mjs",
    "templates/answer-key.md", "mutation-testing.md", "cold-start-test.md"]) {
    const p = path.join(skillDir, f);
    assert.ok(fs.existsSync(p) && fs.statSync(p).size > 200, `${f} missing or empty`);
  }
  assert.ok(fs.statSync(path.join(root, "docs", "continuity.md")).size > 500);
  // Sections the decision called for.
  assert.match(read("skills", "memory-continuity", "templates", "HANDOVER.md"), /Old rules that changed/);
  assert.match(read("skills", "memory-continuity", "SKILL.md"), /Where lessons go/);
  const doc = read("docs", "continuity.md");
  for (const h of ["G5", "G6", "G7", "G9", "G11"]) assert.ok(doc.includes(h), `docs/continuity.md lacks ${h}`);
});

test("the cold-start guide uses the existing verifier and no new agent exists", () => {
  assert.match(read("skills", "memory-continuity", "cold-start-test.md"), /memory-verifier/);
  assert.deepEqual(fs.readdirSync(path.join(root, "agents")), ["memory-verifier.md"]);
});

test("main persistent-memory-system SKILL.md is unchanged", () => {
  const h = createHash("sha256").update(Buffer.from(fs.readFileSync(path.join(root, "skills", "persistent-memory-system", "SKILL.md")).toString("latin1").replace(/\r\n/g, "\n"), "latin1")).digest("hex");
  assert.equal(h, MAIN_SKILL_SHA256);
});

test("version 1.3.0 is the same in plugin.json, both READMEs and the changelog", () => {
  const v = JSON.parse(read(".claude-plugin", "plugin.json")).version;
  assert.equal(v, "1.3.0");
  assert.match(read("README.md"), new RegExp(`^# .*\\(v${v.replaceAll(".", "\\.")}\\)`, "m"));
  assert.match(read("README.ar.md"), new RegExp(`^# .*\\(v${v.replaceAll(".", "\\.")}\\)`, "m"));
  assert.match(read("CHANGELOG.md"), new RegExp(`^## ${v.replaceAll(".", "\\.")} `, "m"));
  assert.match(read("README.md"), /memory-continuity/);
});

// ---- mutation test of the inventory template (G3): every artificial fault must be caught, undoing it must pass ----
const inv = path.join(skillDir, "templates", "continuity-inventory.mjs");
const sh = (r) => createHash("sha256").update(r).digest("hex");

function makeProject() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "cont-"));
  const w = (rel, txt) => { const f = path.join(d, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, txt); };
  w("Deliverables/Main/main-report_v2.md", "report body\n");
  w("Deliverables/Main/main-report_cover_v2.txt", "cover\n");
  w("Deliverables/Main/_archive/main-report_v1.md", "old\n");
  w("Deliverables/Main/script.md", "script\n");
  w("Jobs/job.md", "## STATUS\ncurrent: main-report_v2.md\n");
  w("Jobs/links.md", "https://example.test/pdf/abc\n");
  w("CLAUDE.md", "# Start here\nRead MDs/HANDOVER.md first.\n");
  w("MDs/HANDOVER.md", "# HANDOVER\n");
  const cfg = {
    deliverables: [{ key: "main", dir: "Deliverables/Main", stem: "main-report", version: "v2", ext: "md", companions: ["{stem}_cover_{version}.txt"] }],
    requiredFiles: ["Deliverables/Main/script.md"],
    mentions: [{ file: "Jobs/job.md", mustContain: ["## STATUS", "{current:main}"] }, { file: "Jobs/links.md", mustContain: ["{link:pdf}"] }],
    entryPoints: [{ file: "MDs/HANDOVER.md" }, { file: "CLAUDE.md", mustContain: "HANDOVER" }],
  };
  fs.writeFileSync(path.join(d, "cfg.json"), "﻿" + JSON.stringify(cfg)); // BOM on purpose: must be tolerated
  return d;
}
const run = (d, ...a) => spawnSync(process.execPath, [inv, "--root", d, "--config", path.join(d, "cfg.json"), ...a], { encoding: "utf8" });
const setLive = (d, daysAgo) => {
  const mp = path.join(d, "Jobs", "state_manifest.json");
  const m = JSON.parse(fs.readFileSync(mp, "utf8"));
  m.links = { pdf: "https://example.test/pdf/abc?dl=0" };
  m.live = { verified: { platformA: { at: new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 19), how: "test" } } };
  fs.writeFileSync(mp, JSON.stringify(m));
};

test("inventory: without a manifest it exits 2; init then check passes", () => {
  const d = makeProject();
  assert.equal(run(d).status, 2);
  assert.equal(run(d, "--init").status, 0);
  setLive(d, 0);
  const r = run(d);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^PASS: (\d+) of \1 checks/);
  assert.ok(fs.existsSync(path.join(d, "Jobs", "state_report.md")));
});

const faults = [
  ["delete the current deliverable", /current file main-report_v2\.md exists/,
    (d) => { const f = path.join(d, "Deliverables/Main/main-report_v2.md"); const b = fs.readFileSync(f); fs.rmSync(f); return () => fs.writeFileSync(f, b); }],
  ["append one byte", /SHA-256 matches the manifest/,
    (d) => { const f = path.join(d, "Deliverables/Main/main-report_v2.md"); const b = fs.readFileSync(f); fs.appendFileSync(f, "x"); return () => fs.writeFileSync(f, b); }],
  ["second versioned file", /only one versioned file/,
    (d) => { const f = path.join(d, "Deliverables/Main/main-report_v9.md"); fs.writeFileSync(f, "x"); return () => fs.rmSync(f); }],
  ["a FINAL name", /no "FINAL" name/,
    (d) => { const f = path.join(d, "Deliverables/Main/notes_FINAL.txt"); fs.writeFileSync(f, "x"); return () => fs.rmSync(f); }],
  ["delete the companion", /companion main-report_cover_v2\.txt/,
    (d) => { const f = path.join(d, "Deliverables/Main/main-report_cover_v2.txt"); const b = fs.readFileSync(f); fs.rmSync(f); return () => fs.writeFileSync(f, b); }],
  ["job file loses the file name", /Jobs\/job\.md contains \{current:main\}/,
    (d) => { const f = path.join(d, "Jobs/job.md"); const b = fs.readFileSync(f); fs.writeFileSync(f, "## STATUS\n"); return () => fs.writeFileSync(f, b); }],
  ["link missing from its file", /Jobs\/links\.md contains \{link:pdf\}/,
    (d) => { const f = path.join(d, "Jobs/links.md"); const b = fs.readFileSync(f); fs.writeFileSync(f, "none\n"); return () => fs.writeFileSync(f, b); }],
  ["stale live verification", /live state \(platformA\)/,
    (d) => { setLive(d, 10); return () => setLive(d, 0); }],
  ["CLAUDE.md no longer points to HANDOVER", /entry point CLAUDE\.md contains HANDOVER/,
    (d) => { const f = path.join(d, "CLAUDE.md"); const b = fs.readFileSync(f); fs.writeFileSync(f, "# nothing\n"); return () => fs.writeFileSync(f, b); }],
];
for (const [name, expect, apply] of faults) {
  test(`inventory mutation: ${name} is caught, undoing it passes again`, () => {
    const d = makeProject();
    run(d, "--init"); setLive(d, 0);
    assert.equal(run(d).status, 0, "baseline must pass");
    const undo = apply(d);
    const bad = run(d);
    assert.equal(bad.status, 1, `fault not caught: ${bad.stdout}`);
    assert.match(bad.stdout, expect);
    undo();
    const ok = run(d);
    assert.equal(ok.status, 0, ok.stdout);
  });
}

test("inventory: sha helper sanity (guards the test itself)", () => {
  assert.equal(sh("a"), "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
});
