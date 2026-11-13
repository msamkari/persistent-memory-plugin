import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "../scripts/gate-rules.mjs";
import { pick } from "../scripts/envpick.mjs";

// What the plugin directory's review looks for: narrow pre-approvals, no whole-environment reads, a gate that
// can never approve a command, and the privacy / support / terms links.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const skills = readdirSync(join(root, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const frontOf = (s) => s.replace(/\r\n/g, "\n").split("\n---\n")[0];
const allowed = (name) => { const m = frontOf(read(`skills/${name}/SKILL.md`)).match(/^allowed-tools:\s*(.+)$/m); return m ? m[1] : ""; };
const BASH_ENTRIES = (v) => [...v.matchAll(/Bash\(([^)]*)\)/g)].map((m) => m[1]);

test("no skill pre-approves a broad shell grant: every Bash entry is one exact plugin script", () => {
  for (const name of skills) {
    const v = allowed(name);
    assert.doesNotMatch(v, /Bash\(\*|Bash\(node:\*\)|Bash\([a-z]+:\*\)|\bBash\b(?!\()/, name + ": " + v);
    assert.doesNotMatch(v, /\b(Edit|Write|NotebookEdit)\b/, name + " must not pre-approve file writes");
    for (const e of BASH_ENTRIES(v)) assert.match(e, /^node \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/[a-z-]+\.mjs( \*)?$/, name + ": " + e);
  }
});

test("every plugin command a skill tells Claude to run is covered by its own pre-approval, in the same unquoted form", () => {
  for (const name of skills) {
    const entries = BASH_ENTRIES(allowed(name)).map((e) => e.replace(/ \*$/, ""));
    const body = read(`skills/${name}/SKILL.md`);
    const cmds = [...body.matchAll(/node (\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/[a-z-]+\.mjs)/g)].map((m) => "node " + m[1]);
    if (entries.length === 0) { assert.ok(!/node "\$\{CLAUDE_PLUGIN_ROOT\}/.test(body) || name === "memory-log", name); continue; }
    assert.ok(cmds.length > 0, name + " has pre-approvals but shows no command");
    for (const c of cmds) assert.ok(entries.includes(c), `${name}: ${c} is not covered by allowed-tools (${entries.join(" | ")})`);
    assert.doesNotMatch(body, /node "\$\{CLAUDE_PLUGIN_ROOT\}/, name + ": the quoted form would not match the pre-approval");
  }
});

test("no script or hook hands the whole environment object around (only named variables are read)", () => {
  const files = [...readdirSync(join(root, "scripts")).map((f) => "scripts/" + f), ...readdirSync(join(root, "hooks")).map((f) => "hooks/" + f)].filter((f) => f.endsWith(".mjs"));
  for (const f of files) {
    const src = read(f).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    const bad = [...src.matchAll(/process\.env(?![.\[A-Za-z_])/g)];
    assert.equal(bad.length, 0, `${f} uses the whole process.env object`);
  }
  assert.deepEqual(pick(["PMS_NOT_SET_ANYWHERE_123"]), {});
  process.env.PMS_PICK_TEST = "1"; process.env.PMS_PICK_OTHER = "2";
  assert.deepEqual(pick(["PMS_PICK_TEST"]), { PMS_PICK_TEST: "1" });
  delete process.env.PMS_PICK_TEST; delete process.env.PMS_PICK_OTHER;
});

test("the approval gate can only deny or ask, never allow", () => {
  const sample = [
    "git commit -m 'x\n\nCo-Authored-By: A <a@b.c>'", "gh pr create --body 'Generated with Claude Code'", "git push --force origin main", "git push -f", "git status", "ls", "rm -rf /", "node -e 1", "",
  ];
  for (const c of sample) { const d = decide(c, {}); if (d) assert.ok(["deny", "ask"].includes(d.decision), c); }
  const NL = String.fromCharCode(10);
  const src = (read("scripts/gate-rules.mjs") + read("hooks/approval-gate.mjs")).split(NL).filter((l) => !l.trim().startsWith("//")).join(NL);
  assert.doesNotMatch(src, /decision:\s*"allow"|permissionDecision:\s*"allow"|"allow"/);
});

test("plugin.json links the privacy policy, support and terms, and those pages exist in both languages", () => {
  const m = JSON.parse(read(".claude-plugin/plugin.json"));
  for (const k of ["privacyPolicyUrl", "supportUrl", "termsOfServiceUrl"]) assert.match(m[k], /^https:\/\/github\.com\/msamkari\/persistent-memory-plugin\//, k);
  assert.ok(m.privacyPolicyUrl.endsWith("/docs/PRIVACY.md") && existsSync(join(root, "docs", "PRIVACY.md")) && existsSync(join(root, "docs", "PRIVACY.ar.md")));
  const heads = (f) => (read(f).match(/^## /gm) || []).length;
  assert.equal(heads("docs/PRIVACY.md"), heads("docs/PRIVACY.ar.md"));
  assert.match(read("docs/PRIVACY.md"), /sends nothing|Nothing\. The plugin does not contact any server/i);
  assert.match(read("docs/PRIVACY.md"), /## Terms of use/);
});
