import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Guards against stray files being committed by accident (a scratch folder once slipped in via `git add -A`).
// Every tracked top-level entry must be listed here; adding a new one is a deliberate edit of this test.
const ALLOWED_TOP = new Set([
  ".claude-plugin", ".github", "agents", "docs", "evals", "hooks", "scripts", "skills", "tests",
  "CHANGELOG.md", "INSTALL.md", "LICENSE", "NOTICE", "README.md", "README.ar.md", ".gitignore",
]);
const MAX_PATH = 120;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const r = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
const inRepo = r.status === 0 && r.stdout.trim().length > 0;

test("tracked files stay inside the known top-level layout", { skip: !inRepo && "not a git checkout" }, () => {
  const files = r.stdout.split("\n").filter(Boolean);
  const stray = [...new Set(files.map((f) => f.split("/")[0]))].filter((t) => !ALLOWED_TOP.has(t));
  assert.deepEqual(stray, [], `unexpected top-level entries committed: ${stray.join(", ")}`);
});

test("no tracked path is absurdly long", { skip: !inRepo && "not a git checkout" }, () => {
  const long = r.stdout.split("\n").filter((f) => f.length > MAX_PATH);
  assert.deepEqual(long, [], `paths over ${MAX_PATH} characters: ${long.map((f) => f.slice(0, 60) + "...").join(", ")}`);
});
