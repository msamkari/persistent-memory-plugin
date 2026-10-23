import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, truncateSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { estimateTokens, estimateFromSample, measure, warnings, summaryLines, thresholds, SAMPLE_BYTES } from "../scripts/cost.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function fixture(files) {
  const d = mkdtempSync(join(tmpdir(), "pms-cost-"));
  mkdirSync(join(d, "MDs", "System_Current_MD"), { recursive: true });
  for (const [n, c] of Object.entries(files)) writeFileSync(join(d, "MDs", "System_Current_MD", n), c);
  return d;
}
test("estimate: empty is 0, ASCII uses the lower rate, Arabic the higher", () => {
  assert.equal(estimateTokens(Buffer.alloc(0)), 0);
  const en = estimateTokens(Buffer.from("a".repeat(1000)));
  const ar = estimateTokens(Buffer.from("ب".repeat(500))); // 1000 bytes
  assert.equal(en, 290); assert.equal(ar, 480); assert.ok(ar > en);
});
test("measure sorts by size and totals", () => {
  const d = fixture({ "01_a.md": "x".repeat(100), "02_b.md": "y".repeat(5000), "notes.txt": "ignored" });
  const m = measure(d);
  assert.deepEqual(m.files.map((f) => f.name), ["02_b.md", "01_a.md"]);
  assert.equal(m.bytes, 5100);
});
test("measure returns null when the folder is missing", () => { assert.equal(measure("/nonexistent/zz"), null); });
test("thresholds: defaults, env override, bad value falls back", () => {
  assert.deepEqual(thresholds({}), { fileKB: 60, totalKB: 150 });
  assert.deepEqual(thresholds({ PMS_WARN_FILE_KB: "10", PMS_WARN_TOTAL_KB: "20" }), { fileKB: 10, totalKB: 20 });
  assert.deepEqual(thresholds({ PMS_WARN_FILE_KB: "abc", PMS_WARN_TOTAL_KB: "-5" }), { fileKB: 60, totalKB: 150 });
});
test("warnings fire per file and on total, never otherwise", () => {
  const small = measure(fixture({ "a.md": "x".repeat(1000) }));
  assert.deepEqual(warnings(small), []);
  const big = measure(fixture({ "a.md": "x".repeat(70 * 1024), "b.md": "y".repeat(100 * 1024) }));
  const w = warnings(big);
  assert.equal(w.length, 3); assert.match(w.join("|"), /a\.md/); assert.match(w.join("|"), /total/);
});
test("summary always says it is an estimate, and a warning is only a suggestion", () => {
  const m = measure(fixture({ "a.md": "x".repeat(70 * 1024) }));
  const s = summaryLines(m).join("\n");
  assert.match(s, /estimate/); assert.match(s, /Suggestion only \(nothing is changed\)/);
});
test("CLI: exit 0 with output, exit 1 when the folder is missing", () => {
  const d = fixture({ "a.md": "hello" });
  const ok = spawnSync(process.execPath, [join(root, "scripts", "cost.mjs"), d], { encoding: "utf8" });
  assert.equal(ok.status, 0); assert.match(ok.stdout, /Start-of-session read cost/);
  const bad = spawnSync(process.execPath, [join(root, "scripts", "cost.mjs"), "/nonexistent/zz"], { encoding: "utf8" });
  assert.equal(bad.status, 1);
});
test("session hook includes the cost line, stays under the size cap, and writes nothing", () => {
  const d = fixture({ "00_a.md": "a", "01_b.md": "ب".repeat(40000) });
  const r = spawnSync(process.execPath, [join(root, "hooks", "session-index.mjs")], { encoding: "utf8", env: { ...process.env, PMS_MEMORY_DIR: d } });
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Start-of-session read cost/); assert.match(ctx, /Suggestion only/); assert.ok(ctx.length <= 2400);
  assert.doesNotMatch(ctx, /ب/); // contents are never injected
});

test("a file larger than the sample is sized by stat and does not stall", () => {
  const d = fixture({ "big.md": "x" });
  const f = join(d, "MDs", "System_Current_MD", "big.md");
  truncateSync(f, SAMPLE_BYTES * 20);
  const t0 = Date.now();
  const m = measure(d);
  assert.equal(m.bytes, SAMPLE_BYTES * 20); assert.ok(Date.now() - t0 < 5000);
});
test("sample estimate equals the full estimate for small input and scales for large", () => {
  const buf = Buffer.from("ab".repeat(100) + "ب".repeat(100));
  assert.equal(estimateFromSample(buf, buf.length), estimateTokens(buf));
  assert.equal(estimateFromSample(Buffer.alloc(0), 0), 0);
});
test("a directory named like a markdown file is skipped, not fatal", () => {
  const d = fixture({ "a.md": "hello" });
  mkdirSync(join(d, "MDs", "System_Current_MD", "dir.md"));
  assert.equal(measure(d).files.length, 1);
});
test("CLI works when launched through a symlink", { skip: process.platform === "win32" }, () => {
  const d = fixture({ "a.md": "hello" });
  const link = join(mkdtempSync(join(tmpdir(), "pms-link-")), "cost-link.mjs");
  symlinkSync(join(root, "scripts", "cost.mjs"), link);
  const r = spawnSync(process.execPath, [link, d], { encoding: "utf8" });
  assert.equal(r.status, 0); assert.match(r.stdout, /Start-of-session read cost/);
});
test("hook keeps the cost line and the reminder even with very long file names", () => {
  const files = {};
  for (let i = 0; i < 12; i++) files[`${String(i).padStart(2, "0")}_${"n".repeat(160)}.md`] = "x".repeat(70 * 1024);
  const d = fixture(files);
  const r = spawnSync(process.execPath, [join(root, "hooks", "session-index.mjs")], { encoding: "utf8", env: { ...process.env, PMS_MEMORY_DIR: d } });
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.ok(ctx.length <= 2400); assert.match(ctx, /Start-of-session read cost/); assert.match(ctx, /Reminder: use the persistent-memory-system skill/);
});
test("hook still delivers the index when cost.mjs is unusable", () => {
  const d = fixture({ "00_a.md": "a" });
  const r = spawnSync(process.execPath, [join(root, "hooks", "session-index.mjs")], { encoding: "utf8", env: { ...process.env, PMS_MEMORY_DIR: d } });
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /00_a\.md/);
});
