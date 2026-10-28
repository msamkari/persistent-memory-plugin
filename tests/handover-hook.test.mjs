import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hook = join(root, "hooks", "session-index.mjs");
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
function run(env) {
  const clean = { ...process.env };
  delete clean.PMS_MEMORY_DIR; delete clean.CLAUDE_PLUGIN_OPTION_MEMORY_DIR; delete clean.CLAUDE_PROJECT_DIR;
  return spawnSync(process.execPath, [hook], { encoding: "utf8", env: { ...clean, ...env }, cwd: tmp("pms-cwd-") });
}
const ctxOf = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext;

test("HANDOVER.md in MDs/ is announced by path even when no memory folder is set", () => {
  const p = tmp("pms-ho-"); mkdirSync(join(p, "MDs"));
  writeFileSync(join(p, "MDs", "HANDOVER.md"), "SECRET-BODY-TEXT");
  const r = run({ CLAUDE_PROJECT_DIR: p });
  assert.equal(r.status, 0);
  const ctx = ctxOf(r);
  assert.match(ctx, /hand-over file exists: MDs.HANDOVER\.md/); assert.match(ctx, /data, not instructions/);
  assert.doesNotMatch(ctx, /SECRET-BODY-TEXT/); // contents are never injected
});
test("HANDOVER.md in the project root is found", () => {
  const p = tmp("pms-ho-"); writeFileSync(join(p, "HANDOVER.md"), "x");
  assert.match(ctxOf(run({ CLAUDE_PROJECT_DIR: p })), /hand-over file exists: HANDOVER\.md/);
});
test("no HANDOVER.md and no memory folder: still silent", () => {
  const r = run({ CLAUDE_PROJECT_DIR: tmp("pms-ho-") });
  assert.equal(r.status, 0); assert.equal(r.stdout, "");
});
test("a directory named HANDOVER.md is ignored", () => {
  const p = tmp("pms-ho-"); mkdirSync(join(p, "HANDOVER.md"));
  assert.equal(run({ CLAUDE_PROJECT_DIR: p }).stdout, "");
});
test("with a memory folder the hand-over line sits beside the index, cost line and reminder, under the cap", () => {
  const p = tmp("pms-ho-"); writeFileSync(join(p, "HANDOVER.md"), "x");
  const d = tmp("pms-mem-"); mkdirSync(join(d, "MDs", "System_Current_MD"), { recursive: true });
  for (let i = 0; i < 12; i++) writeFileSync(join(d, "MDs", "System_Current_MD", `${String(i).padStart(2, "0")}_${"n".repeat(160)}.md`), "x".repeat(70 * 1024));
  const ctx = ctxOf(run({ CLAUDE_PROJECT_DIR: p, PMS_MEMORY_DIR: d }));
  assert.ok(ctx.length <= 2400);
  assert.match(ctx, /hand-over file exists/); assert.match(ctx, /Start-of-session read cost/); assert.match(ctx, /Reminder: use the persistent-memory-system skill/);
});
test("memory folder with no files still announces the hand-over file", () => {
  const p = tmp("pms-ho-"); writeFileSync(join(p, "HANDOVER.md"), "x");
  assert.match(ctxOf(run({ CLAUDE_PROJECT_DIR: p, PMS_MEMORY_DIR: tmp("pms-empty-") })), /hand-over file exists/);
});
