import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { spawnSync } from "node:child_process"; import { fileURLToPath } from "node:url";
import { decide } from "../scripts/gate-rules.mjs";
import { appendActivity, tailActivity } from "../scripts/activity.mjs";
const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "hooks", "approval-gate.mjs");

test("trailers and session links in commits/PRs are denied", () => {
  assert.equal(decide('git commit -m "x\n\nCo-Authored-By: Claude <a@b>"').decision, "deny");
  assert.equal(decide('git commit -m "x\n\nClaude-Session: https://claude.ai/code/session_1"').decision, "deny");
  assert.equal(decide('gh pr create --body "Generated with [Claude Code](x)"').decision, "deny");
});
test("plain commits, other commands and explicit override pass", () => {
  assert.equal(decide('git commit -m "Fix typo"'), null);
  assert.equal(decide('grep -r "Co-Authored-By" .'), null);
  assert.equal(decide('git commit -m "Co-Authored-By: x"', { PMS_ALLOW_TRAILERS: "1" }), null);
  assert.equal(decide(undefined), null);
});
test("force push asks; normal push passes", () => {
  assert.equal(decide("git push --force-with-lease=main:abc origin main").decision, "ask");
  assert.equal(decide("git push -f origin main").decision, "ask");
  assert.equal(decide("git push origin main"), null);
  assert.equal(decide("git push origin feature-fix"), null);
});
test("hook end to end: stdin in, JSON decision out, fails open on garbage, logs when folder set", () => {
  const mem = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
  const run = (input) => spawnSync(process.execPath, [HOOK], { input, encoding: "utf8", env: { ...process.env, PMS_MEMORY_DIR: mem } });
  const r = run(JSON.stringify({ tool_name: "Bash", tool_input: { command: 'git commit -m "a\nCo-Authored-By: X"' } }));
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(run("not json").stdout, "");
  assert.equal(run(JSON.stringify({ tool_input: { command: "ls" } })).stdout, "");
  const lines = tailActivity(mem, 5);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).action, "no-trailers");
});
test("activity log is append-only and never creates the memory folder", () => {
  assert.equal(appendActivity("/nonexistent/dir/xyz", { action: "x" }), false);
  const mem = fs.mkdtempSync(path.join(os.tmpdir(), "act-"));
  appendActivity(mem, { action: "a" }); appendActivity(mem, { action: "b" });
  assert.deepEqual(tailActivity(mem, 10).map((l) => JSON.parse(l).action), ["a", "b"]);
});
