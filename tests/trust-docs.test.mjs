import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Pins the trust documentation to the code: what the README says the hooks do must stay true,
// and the NotebookLM skill must keep saying there is no official connector.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const section = (text, heading) => {
  const i = text.indexOf(heading);
  assert.ok(i >= 0, `missing section ${heading}`);
  const rest = text.slice(i + heading.length);
  const j = rest.search(/\n## /);
  return j < 0 ? rest : rest.slice(0, j);
};

const hooksJson = JSON.parse(read("hooks/hooks.json"));
const hookEvents = Object.keys(hooksJson.hooks).sort();

test("every hook event in hooks.json is documented in both README sections", () => {
  const en = section(read("README.md"), "## What runs on your computer");
  const ar = section(read("README.ar.md"), "## ماذا يعمل على جهازك");
  for (const ev of hookEvents) {
    assert.ok(en.includes(ev), `README.md section does not mention ${ev}`);
    assert.ok(ar.includes(ev), `README.ar.md section does not mention ${ev}`);
  }
});

test("the documented hook events are exactly the ones that exist", () => {
  assert.deepEqual(hookEvents, ["PreToolUse", "SessionStart", "Stop"]);
});

test("hooks and scripts contain no network or process-spawning code (the README says none)", () => {
  const banned = /node:(http|https|http2|net|tls|dgram|dns|child_process|worker_threads)|\bfetch\s*\(|XMLHttpRequest|\bspawn(Sync)?\s*\(|\bexec(Sync|File|FileSync)?\s*\(|\bWebSocket\b/;
  const offenders = [];
  for (const dir of ["hooks", "scripts"]) {
    for (const f of readdirSync(join(root, dir)).filter((n) => n.endsWith(".mjs"))) {
      const src = read(`${dir}/${f}`).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      if (banned.test(src)) offenders.push(`${dir}/${f}`);
    }
  }
  assert.deepEqual(offenders, [], `network/process code found: ${offenders.join(", ")}`);
});

test("notebooklm-reference states there is no official connector and keeps the privacy rule", () => {
  const s = read("skills/notebooklm-reference/SKILL.md");
  const front = s.split("\n---\n")[0];
  assert.match(front, /NO official Claude connector/);
  assert.match(s, /There is no official connector between Claude and a personal NotebookLM account/);
  assert.match(s, /Never upload the Persistent Memory files/);
  assert.match(s, /You never type, read or store a password, cookie or token/);
  assert.match(s, /approval required before installing/);
});

test("notebooklm-reference lets Claude load it (no disable-model-invocation)", () => {
  const front = read("skills/notebooklm-reference/SKILL.md").split("\n---\n")[0];
  assert.doesNotMatch(front, /disable-model-invocation/);
});

test("notebooklm-reference puts the safe manual path before the third-party tools", () => {
  const s = read("skills/notebooklm-reference/SKILL.md");
  const manual = s.indexOf("## Default path: manual and safe");
  const adv = s.indexOf("## Advanced path: a third-party tool");
  assert.ok(manual > 0 && adv > manual, "manual path must come first");
});

test("every skill's one-line description is valid YAML (no bare ': ' or ' #'), so its metadata is not silently dropped", () => {
  const bad = [];
  for (const d of readdirSync(join(root, "skills"))) {
    const front = read(`skills/${d}/SKILL.md`).split("\n---\n")[0];
    const line = front.split("\n").find((l) => l.startsWith("description:"));
    assert.ok(line, `skills/${d} has no description`);
    const value = line.slice("description:".length).trim();
    const plain = value && !/^["'>|]/.test(value);
    if (plain && (/: /.test(value) || / #/.test(value))) bad.push(d);
  }
  assert.deepEqual(bad, [], `unquoted YAML special characters in description of: ${bad.join(", ")}`);
});

test("version is the same in plugin.json, both README titles and the top CHANGELOG entry", () => {
  const v = JSON.parse(read(".claude-plugin/plugin.json")).version;
  assert.match(read("README.md").split("\n")[0], new RegExp(`\\(v${v.replace(/\./g, "\\.")}\\)`));
  assert.match(read("README.ar.md").split("\n")[0], new RegExp(`\\(v${v.replace(/\./g, "\\.")}\\)`));
  assert.match(read("CHANGELOG.md").split("\n").find((l) => l.startsWith("## ")), new RegExp(`^## ${v.replace(/\./g, "\\.")} `));
});
