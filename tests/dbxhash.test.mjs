import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dropboxHashOfBuffer, dropboxHashOfFile, BLOCK } from "../scripts/dbxhash.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "dbxhash.mjs");
// Expected values computed independently with Python's hashlib (sha256 of the concatenated per-block sha256 digests).
const HELLO = "9595c9df90075148eb06860365df33584b75bff782a510c6cd4883a419833d50";
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const BIG = "40b68bc307747f94c4060722ebba2fd6ecddf821e7f02ebe70f5b64e4041f7a5";
const big = () => { const b = Buffer.alloc(9 * 1024 * 1024 + 17); for (let i = 0; i < b.length; i++) b[i] = (i * 7 + 3) % 251; return b; };
const tmpfile = (buf) => { const f = join(mkdtempSync(join(tmpdir(), "dbxh-")), "f.bin"); writeFileSync(f, buf); return f; };

test("known vectors: small, empty, and multi-block (3 blocks) match the independent computation", () => {
  assert.equal(BLOCK, 4 * 1024 * 1024);
  assert.equal(dropboxHashOfBuffer(Buffer.from("hello")), HELLO);
  assert.equal(dropboxHashOfBuffer(Buffer.alloc(0)), EMPTY);
  assert.equal(dropboxHashOfBuffer(big()), BIG);
});
test("file hashing equals buffer hashing, including a size that is not a block multiple", () => {
  const r = dropboxHashOfFile(tmpfile(big()));
  assert.equal(r.hash, BIG); assert.equal(r.size, 9 * 1024 * 1024 + 17);
  assert.equal(dropboxHashOfFile(tmpfile(Buffer.alloc(0))).hash, EMPTY);
});
test("one changed byte changes the hash", () => {
  const b = Buffer.from("مرحبا بالعالم"); const c = Buffer.from(b); c[3] ^= 1;
  assert.notEqual(dropboxHashOfBuffer(b), dropboxHashOfBuffer(c));
});
test("CLI: match exits 0, mismatch exits 1, missing file exits 2, no args exits 2", () => {
  const f = tmpfile(Buffer.from("hello"));
  const run = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: "utf8" });
  const ok = run(f, HELLO); assert.equal(ok.status, 0); assert.match(ok.stdout, /MATCH/);
  const upper = run(f, HELLO.toUpperCase()); assert.equal(upper.status, 0);
  const bad = run(f, EMPTY); assert.equal(bad.status, 1); assert.match(bad.stdout, /MISMATCH/);
  assert.equal(run("/nonexistent/zz").status, 2);
  assert.equal(run().status, 2);
});
