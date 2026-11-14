import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "../scripts/gate-rules.mjs";

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
    for (const e of BASH_ENTRIES(v)) assert.match(e, /^bash \$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/sh\/[a-z-]+\.sh( \*)?$/, name + ": " + e);
  }
});

test("every plugin command a skill tells Claude to run is covered by its own pre-approval, in the same unquoted form", () => {
  for (const name of skills) {
    const entries = BASH_ENTRIES(allowed(name)).map((e) => e.replace(/ \*$/, ""));
    const body = read(`skills/${name}/SKILL.md`);
    const cmds = [...body.matchAll(/bash (\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/sh\/[a-z-]+\.sh)/g)].map((m) => "bash " + m[1]);
    if (entries.length === 0) { assert.ok(!/node "\$\{CLAUDE_PLUGIN_ROOT\}/.test(body) || name === "memory-log", name); continue; }
    assert.ok(cmds.length > 0, name + " has pre-approvals but shows no command");
    for (const c of cmds) assert.ok(entries.includes(c), `${name}: ${c} is not covered by allowed-tools (${entries.join(" | ")})`);
    assert.doesNotMatch(body, /(node|bash) "\$\{CLAUDE_PLUGIN_ROOT\}/, name + ": the quoted form would not match the pre-approval");
  }
});

test("no script or hook reads the environment other than by literal variable names", () => {
  const files = [...readdirSync(join(root, "scripts")).map((f) => "scripts/" + f), ...readdirSync(join(root, "hooks")).map((f) => "hooks/" + f)].filter((f) => f.endsWith(".mjs"));
  for (const f of files) {
    const src = read(f).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.equal([...src.matchAll(/process\.env(?![.\[A-Za-z_])/g)].length, 0, `${f} uses the whole process.env object`);
    assert.equal([...src.matchAll(/process\.env\[(?!["'])/g)].length, 0, `${f} reads an environment variable whose name is computed at run time`);
  }
  assert.ok(!existsSync(join(root, "scripts", "envpick.mjs")), "the computed-name helper must not come back");
});

test("every shell wrapper only starts its own Node script (no shebang, no other command)", () => {
  const dir = join(root, "scripts", "sh");
  for (const f of readdirSync(dir)) {
    const t = read("scripts/sh/" + f).replace(/\r\n/g, "\n");
    const code = t.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
    assert.ok(!t.startsWith("#!"), f + " must not start with a shebang");
    assert.equal(code.length, 1, f);
    const name = f.replace(/\.sh$/, "");
    assert.equal(code[0], `exec node "$(dirname "$0")/../${name}.mjs" "$@"`, f);
    assert.ok(existsSync(join(root, "scripts", name + ".mjs")), name + ".mjs");
  }
});

test("the shell wrappers keep LF line endings and really start their Node script", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  for (const f of readdirSync(join(root, "scripts", "sh"))) assert.ok(!readFileSync(join(root, "scripts", "sh", f)).includes(13), f + " has a carriage return (bash would fail)");
  const probe = spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" });
  if (probe.status !== 0) return; // no bash here: the byte check above is what can be verified
  const dir = mkdtempSync(join(tmpdir(), "pms-sh-"));
  const r = spawnSync("bash", [join(root, "scripts", "sh", "doctor.sh"), dir], { encoding: "utf8" });
  assert.ok(r.status === 0 || r.status === 1 || r.status === 2, "doctor.sh did not run: " + r.stderr);
  assert.doesNotMatch(r.stderr, /command not found|No such file|syntax error/i);
  assert.ok((r.stdout + r.stderr).length > 0, "doctor.sh printed nothing");
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
  for (const k of ["privacyPolicyUrl", "supportUrl", "termsOfServiceUrl"]) assert.ok(m[k].startsWith("https://github.com/msamkari/persistent-memory-plugin/"), k);
  assert.ok(m.privacyPolicyUrl.endsWith("/docs/PRIVACY.md") && existsSync(join(root, "docs", "PRIVACY.md")) && existsSync(join(root, "docs", "PRIVACY.ar.md")));
  const heads = (f) => (read(f).match(/^## /gm) || []).length;
  assert.equal(heads("docs/PRIVACY.md"), heads("docs/PRIVACY.ar.md"));
  assert.match(read("docs/PRIVACY.md"), /sends nothing|Nothing\. The plugin does not contact any server/i);
  assert.match(read("docs/PRIVACY.md"), /## Terms of use/);
});

test("the listing icon is a square PNG between 512 and 2048 px and under 2 MB", () => {
  const f = join(root, ".claude-plugin", "icon" + String.fromCharCode(46) + "png");
  assert.ok(existsSync(f), "the listing icon is missing");
  const b = readFileSync(f);
  assert.equal(b.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "not a PNG");
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  assert.equal(w, h, "the icon must be square");
  assert.ok(w >= 512 && w <= 2048, "width " + w);
  assert.ok(b.length < 2 * 1024 * 1024, "size " + b.length);
});


test("no script, hook or test source reads an environment variable through a computed name or a bracket", () => {
  const dirs = ["scripts", "hooks", "tests"];
  for (const d of dirs) for (const f of readdirSync(join(root, d)).filter((x) => x.endsWith(".mjs"))) {
    if (f === "directory-readiness.test.mjs") continue; // this file spells the patterns it looks for
    const src = read(d + "/" + f);
    assert.equal([...src.matchAll(/process\.env\[|\benv\[/g)].length, 0, `${d}/${f} reads an environment variable by a bracket or computed name`);
  }
});

