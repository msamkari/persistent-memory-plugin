import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hook = join(root, "hooks", "end-of-work.mjs");
const T0 = 1_800_000_000; // fixed epoch seconds; file times never depend on the clock
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const put = (base, rel, t, body = "x") => {
  const p = join(base, ...rel.split("/")); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); utimesSync(p, t, t); return p;
};
const CFG = { state: ["MDs/HANDOVER.md", "Jobs/state_manifest.json"], work: ["Jobs/", "MDs/Templates/", "notes.md"] };
function project(cfg = CFG, { stateT = T0, workT = T0 + 500 } = {}) {
  const p = tmp("pms-eow-");
  if (cfg) put(p, "MDs/freshness.json", T0 - 9999, JSON.stringify(cfg));
  put(p, "MDs/HANDOVER.md", stateT); put(p, "Jobs/state_manifest.json", stateT);
  put(p, "Jobs/log.md", workT); put(p, "MDs/Templates/t.md", T0 - 100);
  return p;
}
const iso = (sec) => new Date(sec * 1000).toISOString();
// transcript lines like Claude Code writes them: queue entry first, then assistant tool_use blocks
function transcript(p, blocks, { first = "hello", start = T0 - 1000 } = {}) {
  const lines = [JSON.stringify({ type: "queue-operation", timestamp: iso(start), content: first })];
  for (const b of blocks) lines.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", ...b }] } }));
  const f = join(p, "session.jsonl"); writeFileSync(f, lines.join("\n") + "\n"); return f;
}
const run = (p, stdin, env = {}) => {
  const clean = { ...process.env }; delete clean.CLAUDE_PROJECT_DIR;
  return spawnSync(process.execPath, [hook], { input: typeof stdin === "string" ? stdin : JSON.stringify(stdin), encoding: "utf8", env: { ...clean, CLAUDE_PROJECT_DIR: p, ...env } });
};
const wrote = (p, rel) => ({ name: "Edit", input: { file_path: join(p, ...rel.split("/")) } });

test("no config: silent, even with stale-looking files", () => {
  const p = project(null); const r = run(p, { transcript_path: transcript(p, [wrote(p, "Jobs/log.md")]) });
  assert.equal(r.status, 0); assert.equal(r.stdout, "");
});
test("session wrote a work file after the state files: blocks once with a reason naming it", () => {
  const p = project(); const r = run(p, { transcript_path: transcript(p, [wrote(p, "Jobs/log.md")]), stop_hook_active: false });
  assert.equal(r.status, 0); const j = JSON.parse(r.stdout);
  assert.equal(j.decision, "block"); assert.match(j.reason, /Jobs\/log\.md/); assert.match(j.reason, /MDs\/HANDOVER\.md/);
});
test("second pass (stop_hook_active) never blocks", () => {
  const p = project(); const r = run(p, { transcript_path: transcript(p, [wrote(p, "Jobs/log.md")]), stop_hook_active: true });
  assert.equal(r.stdout, "");
});
test("a mere read of the work file does not count", () => {
  const p = project(); const r = run(p, { transcript_path: transcript(p, [{ name: "Read", input: { file_path: join(p, "Jobs", "log.md") } }, { name: "Bash", input: { command: "cat Jobs/log.md" } }]) });
  assert.equal(r.stdout, "");
});
test("a file changed by another session (not in this transcript) does not count", () => {
  const p = project(); const r = run(p, { transcript_path: transcript(p, [{ name: "Read", input: { file_path: "/somewhere/else.md" } }]) });
  assert.equal(r.stdout, "");
});
test("a shell write that names the file counts (append and redirect)", () => {
  const p = project(); const r = run(p, { transcript_path: transcript(p, [{ name: "Bash", input: { command: "printf 'x' >> Jobs/log.md" } }]) });
  assert.equal(JSON.parse(r.stdout).decision, "block");
});
test("Windows backslash paths, JSON-escaped in the transcript, are matched", () => {
  const p = project(); const winPath = join(p, "Jobs", "log.md").replace(/\//g, "\\");
  const r = run(p, { transcript_path: transcript(p, [{ name: "Write", input: { file_path: winPath } }]) });
  assert.equal(JSON.parse(r.stdout).decision, "block");
});
test("state files updated after the work: allow", () => {
  const p = project(CFG, { stateT: T0 + 900, workT: T0 + 500 });
  assert.equal(run(p, { transcript_path: transcript(p, [wrote(p, "Jobs/log.md")]) }).stdout, "");
});
test("the oldest state file decides (manifest updated, HANDOVER not)", () => {
  const p = project(CFG, { stateT: T0, workT: T0 + 500 }); put(p, "Jobs/state_manifest.json", T0 + 900);
  assert.equal(JSON.parse(run(p, { transcript_path: transcript(p, [wrote(p, "Jobs/log.md")]) }).stdout).decision, "block");
});
test("a scheduled-task session is never stopped", () => {
  const p = project(); const r = run(p, { transcript_path: transcript(p, [wrote(p, "Jobs/log.md")], { first: '<scheduled-task name="x">' }) });
  assert.equal(r.stdout, "");
});
test("changes older than the session start are ignored", () => {
  const p = project(CFG, { stateT: T0, workT: T0 + 500 });
  assert.equal(run(p, { transcript_path: transcript(p, [wrote(p, "Jobs/log.md")], { start: T0 + 800 }) }).stdout, "");
});
test("archive and proposal folders are skipped; extension filter applies", () => {
  const p = project(CFG, { stateT: T0, workT: T0 - 5 });
  put(p, "Jobs/_Archive/old.md", T0 + 500); put(p, "Jobs/_proposals/p.md", T0 + 500); put(p, "Jobs/data.json", T0 + 500);
  const t = transcript(p, ["Jobs/_Archive/old.md", "Jobs/_proposals/p.md", "Jobs/data.json"].map((r) => wrote(p, r)));
  assert.equal(run(p, { transcript_path: t }).stdout, "");
});
test("bad config JSON, empty lists and a missing state file all fail open", () => {
  for (const body of ["{not json", JSON.stringify({ state: [], work: ["Jobs/"] }), JSON.stringify({ state: ["MDs/NOPE.md"], work: ["Jobs/"] })]) {
    const p = project(null); put(p, "MDs/freshness.json", T0 - 9999, body);
    assert.equal(run(p, { transcript_path: transcript(p, [wrote(p, "Jobs/log.md")]) }).stdout, "");
  }
});
test("a BOM in the config file is tolerated", () => {
  const p = project(null); put(p, "MDs/freshness.json", T0 - 9999, "﻿" + JSON.stringify(CFG));
  assert.equal(JSON.parse(run(p, { transcript_path: transcript(p, [wrote(p, "Jobs/log.md")]) }).stdout).decision, "block");
});
test("garbage stdin, missing or unreadable transcript: exit 0 and silent", () => {
  const p = project();
  assert.equal(run(p, "{bad").stdout, ""); assert.equal(run(p, "").stdout, "");
  const r = run(p, { transcript_path: join(p, "does-not-exist.jsonl") }); assert.equal(r.status, 0); assert.equal(r.stdout, "");
});
test("reasonExtra from the config is appended", () => {
  const p = project({ ...CFG, reasonExtra: "Do not touch the other project." });
  assert.match(JSON.parse(run(p, { transcript_path: transcript(p, [wrote(p, "Jobs/log.md")]) }).stdout).reason, /other project/);
});
test("a large transcript is streamed within a few seconds", () => {
  const p = project(); const pad = "y".repeat(200_000); const blocks = [];
  for (let i = 0; i < 120; i++) blocks.push({ name: "Read", input: { file_path: "/x/" + i + ".md", pad } }); // ~24 MB
  blocks.push(wrote(p, "Jobs/log.md"));
  const t = transcript(p, blocks); const t0 = Date.now();
  const r = run(p, { transcript_path: t }); assert.equal(JSON.parse(r.stdout).decision, "block"); assert.ok(Date.now() - t0 < 6000, "took " + (Date.now() - t0));
});
test("hooks.json registers the Stop hook through node and the plugin root", async () => {
  const { readFileSync } = await import("node:fs"); const h = JSON.parse(readFileSync(join(root, "hooks", "hooks.json"), "utf8"));
  const e = h.hooks.Stop[0].hooks[0]; assert.equal(e.command, "node"); assert.match(e.args[0], /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/end-of-work\.mjs$/);
});
