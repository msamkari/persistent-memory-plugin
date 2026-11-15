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

// ---- 1.8.4: options with a separate value, combined flags, +refspec, quotes, shell wrappers, unseen messages ----
const SIG = "Co-Authored" + "-By: X <x@example.invalid>";
test("git -C / -c / --git-dir / --work-tree / git.exe do not hide a commit with a trailer", () => {
  for (const c of [`git -C /repo commit -m "${SIG}"`, `git -c user.name=a commit -m "${SIG}"`, `git -C "/my repo" commit -m "${SIG}"`,
    `git --git-dir /r/.git --work-tree /r commit -m "${SIG}"`, `git.exe commit -m "${SIG}"`, `/usr/bin/git -C . tag -a v1 -m "${SIG}"`,
    `git "commit" -m "${SIG}"`, `bash -c "git commit -m '${SIG}'"`, `powershell -c "git commit -m '${SIG}'"`])
    assert.equal(decide(c, {}).decision, "deny", c);
});
test("git -C / -c in front of push still asks for force", () => {
  for (const c of ["git -C . push --force", "git -C /repo push -f origin main", "git -c http.x=y push --force-with-lease", "git.exe push -f", "git --git-dir=.git push -f"])
    assert.equal(decide(c, {}).decision, "ask", c);
});
test("combined short flags, +refspec, quoted and wrapped pushes ask", () => {
  for (const c of ["git push -fu origin main", "git push -uf origin main", "git push origin +main", "git push origin +HEAD:main",
    'git push "--force"', 'git "push" --force', 'bash -c "git push -f"', "sh -c 'git push -f'", 'powershell -c "git push -f"', 'pwsh -Command "git push -f"',
    "echo ok && git push -f", "git push origin main; git push origin +main"])
    assert.equal(decide(c, {}).decision, "ask", c);
});
test("a commit message read from a file, or a PR body from a file / API field, asks (cannot be checked)", () => {
  for (const c of ["git commit -F msg.txt", "git commit --file=msg.txt", "git -C x commit -aF msg.txt", "gh pr create --title t --body-file b.md",
    "gh pr edit 1 --body-file b.md", "gh api repos/o/r/pulls -f body=hello", "gh api repos/o/r/pulls -F body=@b.md"]) {
    const d = decide(c, {}); assert.equal(d.decision, "ask", c); assert.equal(d.rule, "unseen-message");
  }
  assert.equal(decide("git commit -F msg.txt", { PMS_ALLOW_TRAILERS: "1" }), null);
  assert.equal(decide(`gh api repos/o/r/pulls -f body="${SIG}"`, {}).decision, "deny", "a visible signature is denied, not just asked");
});
test("no new false positives: log, status, plain push, commit-tree, message text that looks like a flag", () => {
  for (const c of ["git log --oneline", "git status", "git -C x log -p", "git commit-tree abc", "git commit -m fix", 'git commit -m "-F"', 'git commit -am "-F x"',
    "git push origin main", "git push -u origin feature-fix", "git push --follow-tags", "git push --set-upstream origin f", "git push origin +", "git fetch origin +main:main",
    "gh pr create --title t --body hi", "gh pr view 1", "gh api repos/o/r -f title=x", "git commit-tree -F x", "ls -f"])
    assert.equal(decide(c, {}), null, c);
});
test("hostile huge inputs stay fast and fail open (no catastrophic backtracking)", () => {
  const cases = ["git push ".repeat(100000), "git -c ".repeat(100000), "bash -c ".repeat(100000), "git commit ".repeat(100000),
    "git " + "- ".repeat(200000), '"git '.repeat(100000), "a;".repeat(200000) + "git push -f", "x ".repeat(200000)];
  for (const c of cases) { const t = Date.now(); decide(c, {}); assert.ok(Date.now() - t < 3000, `slow on ${c.slice(0, 12)}: ${Date.now() - t} ms`); }
  assert.equal(decide("a;".repeat(200000) + "git push -f", {}).decision, "ask");
  assert.equal(decide("\0\u202e'\"\`$(((", {}), null);
});
test("activity tail: negative, zero and junk counts are usage errors; a directory log is a clean error", () => {
  const ACT = path.join(path.dirname(HOOK), "..", "scripts", "activity.mjs");
  const mem = fs.mkdtempSync(path.join(os.tmpdir(), "act2-"));
  for (const a of ["a", "b", "c"]) appendActivity(mem, { action: a });
  const tail = (...args) => spawnSync(process.execPath, [ACT, "tail", ...args], { encoding: "utf8", env: { ...process.env, PMS_MEMORY_DIR: mem, CLAUDE_PLUGIN_OPTION_MEMORY_DIR: "" } });
  assert.deepEqual(tail("2").stdout.trim().split("\n").map((l) => JSON.parse(l).action), ["b", "c"]);
  assert.equal(tail().stdout.trim().split("\n").length, 3);
  for (const bad of ["-1", "0", "x", "1.5", "-0"]) { const r = tail(bad); assert.equal(r.status, 1, bad); assert.match(r.stdout, /^FAIL usage: tail/); }
  const mem2 = fs.mkdtempSync(path.join(os.tmpdir(), "act3-")); fs.mkdirSync(path.join(mem2, "Activity_Log", "activity.jsonl"), { recursive: true });
  const r = spawnSync(process.execPath, [ACT, "tail"], { encoding: "utf8", env: { ...process.env, PMS_MEMORY_DIR: mem2, CLAUDE_PLUGIN_OPTION_MEMORY_DIR: "" } });
  assert.equal(r.status, 1); assert.match(r.stdout, /^FAIL .*not a regular file/); assert.equal(r.stderr, "");
});
