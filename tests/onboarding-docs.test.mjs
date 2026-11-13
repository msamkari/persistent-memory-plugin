import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 1.7.0, the setup offer: pins what the documents and the skills promise to the code.
// The hook may write one marker in the plugin's own data folder and nothing else; the skill never writes without a yes.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const code = (p) => read(p).split("\n").filter((l) => !l.trim().startsWith("//"));
const hookRow = (file, heading) => {
  const t = read(file), i = t.indexOf(heading);
  assert.ok(i >= 0, `missing section ${heading}`);
  return t.slice(i).split("\n").find((l) => l.startsWith("| SessionStart"));
};

test("both READMEs say that SessionStart writes a marker in the plugin's data folder and never in the project", () => {
  const en = hookRow("README.md", "## What runs on your computer"), ar = hookRow("README.ar.md", "## ماذا يعمل على جهازك");
  assert.match(en, /data folder/); assert.match(en, /never in your project/);
  assert.match(ar, /مجلد بيانات الإضافة/); assert.match(ar, /لا يكتب داخل مشروعك/);
});

test("the SessionStart hook has no write call of its own, and onboarding.mjs writes only under its state folder", () => {
  const writes = /\b(writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|renameSync|copyFileSync|createWriteStream|writeSync)\s*\(/;
  assert.deepEqual(code("hooks/session-index.mjs").filter((l) => writes.test(l)), []);
  const calls = code("scripts/onboarding.mjs").join("\n").match(new RegExp(writes.source + "[^,)]*", "g")) || [];
  assert.ok(calls.length >= 4, "expected to find the marker writes");
  for (const c of calls) assert.match(c, /\((markerPath|offPath|stateDir)\(/, `write outside the state folder: ${c}`);
});

test("the Stop hook and the approval gate do not know about the offer", () => {
  for (const f of ["hooks/end-of-work.mjs", "hooks/approval-gate.mjs", "scripts/freshness.mjs", "scripts/gate-rules.mjs"]) {
    assert.doesNotMatch(read(f), /onboarding|setup\.mjs|archive\.mjs/, f);
  }
});

test("memory-setup keeps the consent rule, the decline step and the vitals rule (offer, never install)", () => {
  const s = read("skills/memory-setup/SKILL.md");
  const front = s.split("\n---\n")[0];
  assert.doesNotMatch(front, /disable-model-invocation/); // the session note asks Claude to use it
  assert.match(s, /Write nothing in the project until the user has said yes in chat/);
  assert.match(s, /The session-start note is not consent/);
  assert.ok(s.includes('onboarding.mjs" decline --root "<project root>" --data "${CLAUDE_PLUGIN_DATA}"'));
  assert.ok(s.includes('setup.mjs" init --root "<project root>"'));
  assert.match(s, /This prints the plan and writes nothing/);
  assert.match(s, /\/plugin install vitals@samkari-plugins/);
  assert.match(s, /Do not install it, and do not run any install command yourself/);
  assert.match(s, /only after the user agrees \(`--init --write`/);
});

test("the offer text itself forbids writing without a yes and names the skill", async () => {
  const { OFFER_TEXT } = await import("../scripts/onboarding.mjs");
  assert.match(OFFER_TEXT, /Do not create or change any file unless the user says yes in chat/);
  assert.match(OFFER_TEXT, /persistent-memory:memory-setup/);
  assert.match(OFFER_TEXT, /once per project/);
  assert.ok(OFFER_TEXT.length <= 700);
  assert.doesNotMatch(OFFER_TEXT, /[\\/]Users[\\/]|[A-Za-z]:[\\/]/, "no path in the text");
});

test("the new skills run the plugin's scripts in place: no script is copied into a project", () => {
  for (const d of ["memory-setup", "memory-archive"]) {
    const s = read(`skills/${d}/SKILL.md`);
    const cmds = [...s.matchAll(/node "([^"]+)"/g)].map((m) => m[1]);
    assert.ok(cmds.length > 0, d);
    for (const c of cmds) assert.match(c, /^\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/(setup|archive|onboarding)\.mjs$/);
  }
  assert.deepEqual(readdirSync(join(root, "skills", "memory-setup", "templates")).sort(), ["HANDOVER.start.ar.md", "HANDOVER.start.md"]);
  assert.doesNotMatch(code("scripts/setup.mjs").join("\n"), /copyFileSync|\.mjs"\s*,\s*root/);
});

test("the two hand-over starters have the same shape in English and Arabic", () => {
  const en = read("skills/memory-setup/templates/HANDOVER.start.md"), ar = read("skills/memory-setup/templates/HANDOVER.start.ar.md");
  for (const t of [en, ar]) {
    assert.equal((t.match(/^## /gm) || []).length, 1);
    assert.equal((t.match(/^\d\. /gm) || []).length, 5);
    for (const name of ["Jobs/state_manifest.json", "Jobs/series_log.md", "MDs/System_Current_MD/", "MDs/archive.json", "{{project}}", "{{date}}"]) assert.ok(t.includes(name), name);
  }
});

test("docs/onboarding.md documents every state command and both switches", () => {
  const d = read("docs/onboarding.md");
  for (const w of ["status", "decline", "reset", "off", "PMS_SETUP_OFFER", "CLAUDE_PLUGIN_DATA", "MDs/archive.json", "vitals"]) assert.ok(d.includes(w), w);
});
