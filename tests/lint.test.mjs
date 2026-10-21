import test from "node:test"; import assert from "node:assert";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { spawnSync } from "node:child_process";
const lint = new URL("../scripts/lint.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
function mk(log, summary = "x", prev = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lint-")), c = path.join(d, "MDs", "System_Current_MD");
  fs.mkdirSync(c, { recursive: true });
  fs.writeFileSync(path.join(c, "02_log.md"), log); fs.writeFileSync(path.join(c, "01_s.md"), summary);
  for (const [k, v] of Object.entries(prev)) { const f = path.join(d, "MDs", "System_Previous_MDs", k); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, v); }
  return d;
}
const run = (d, ...a) => spawnSync(process.execPath, [lint, d, ...a], { encoding: "utf8" });
const E = n => `2026-10-01 (${n}) — e\n`;
test("clean log passes", () => { const r = run(mk(E(1) + E(2))); assert.equal(r.status, 0); assert.match(r.stdout, /RESULT: OK/); });
test("gap fails", () => { const r = run(mk(E(1) + E(3))); assert.equal(r.status, 1); assert.match(r.stdout, /missing entry numbers: 2/); });
test("duplicate fails", () => { const r = run(mk(E(1) + E(1))); assert.equal(r.status, 1); assert.match(r.stdout, /duplicate/); });
test("reference to non-existent entry fails", () => { const r = run(mk(E(1), "see بند 7")); assert.equal(r.status, 1); assert.match(r.stdout, /non-existent/); });
test("compressed range counts as covered", () => { const r = run(mk("مدخلات 1 إلى 5\n" + E(6))); assert.equal(r.status, 0); });
test("broken archive link: dry run keeps file, --apply archives then fixes", () => {
  const d = mk(E(1), "x System_Previous_MDs/2026-10/01_s_2026-10-14b.md", { "2026-10/01_s_2026-10-14.md": "old" });
  const f = path.join(d, "MDs", "System_Current_MD", "01_s.md"), before = fs.readFileSync(f, "utf8");
  const r1 = run(d); assert.equal(r1.status, 1); assert.match(r1.stdout, /unique fix/); assert.equal(fs.readFileSync(f, "utf8"), before);
  const r2 = run(d, "--apply"); assert.match(r2.stdout, /fixed 01_s.md/);
  assert.ok(fs.readFileSync(f, "utf8").includes("01_s_2026-10-14.md"));
  const arch = fs.readdirSync(path.join(d, "MDs", "System_Previous_MDs", new Date().toISOString().slice(0, 7)));
  assert.ok(arch.some(x => x.includes("prelint")));
});
test("missing folder fails closed", () => { assert.equal(run(os.tmpdir() + "/nope-" + Date.now()).status, 1); });

test("active job without BUDGET warns; with BUDGET passes", () => {
  const mk = (body) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "lintb-"));
    fs.mkdirSync(path.join(d, "MDs", "System_Current_MD"), { recursive: true });
    fs.mkdirSync(path.join(d, "Jobs"));
    fs.writeFileSync(path.join(d, "Jobs", "j.md"), body);
    return d;
  };
  const run = (d) => spawnSync(process.execPath, [lint, d], { encoding: "utf8" }).stdout;
  assert.match(run(mk("j\n\nSTATUS:\nIN PROGRESS phase 2\n")), /no BUDGET line/);
  assert.doesNotMatch(run(mk("j\n\nSTATUS:\nIN PROGRESS phase 2\nBUDGET: max 5 USD\n")), /no BUDGET line/);
  assert.doesNotMatch(run(mk("j\n\nSTATUS:\nCOMPLETE\n")), /no BUDGET line/);
});
