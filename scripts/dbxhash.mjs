#!/usr/bin/env node
// Dropbox content_hash of a LOCAL file. Read-only, no network, writes nothing.
// Usage: node dbxhash.mjs <file> [expected_hash]
// Exit 0 = printed (and matched the expected hash if one was given), 1 = mismatch, 2 = error.
// Why: Dropbox tools can only create new files, so rewriting a large memory file means re-emitting its
// whole text, and a single wrong character is easy to miss. Compare this hash with the content_hash that
// Dropbox reports for the uploaded file BEFORE moving it into place. See docs/safe-rewrite.md.
import { createHash } from "node:crypto";
import { openSync, readSync, closeSync, statSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const BLOCK = 4 * 1024 * 1024;

// sha256 over the binary sha256 digests of each 4 MiB block (Dropbox's documented algorithm).
export function dropboxHashOfBuffer(buf) {
  const outer = createHash("sha256");
  for (let i = 0; i < buf.length; i += BLOCK) outer.update(createHash("sha256").update(buf.subarray(i, i + BLOCK)).digest());
  return outer.digest("hex");
}

export function dropboxHashOfFile(path) {
  const st = statSync(path);
  if (!st.isFile()) throw Object.assign(new Error("not a regular file"), { code: "ENOTFILE" });
  const size = st.size;
  const outer = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(BLOCK);
    for (let pos = 0; pos < size; pos += BLOCK) {
      const want = Math.min(BLOCK, size - pos);
      let got = 0;
      while (got < want) { // a read may return fewer bytes than asked; keep going until the block is full
        const n = readSync(fd, buf, got, want - got, pos + got);
        if (n === 0) throw Object.assign(new Error("file changed while reading"), { code: "ESHORT" });
        got += n;
      }
      outer.update(createHash("sha256").update(buf.subarray(0, got)).digest());
    }
  } finally { closeSync(fd); }
  return { size, hash: outer.digest("hex") };
}

function isMain() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isMain()) {
  const [file, expectedRaw] = process.argv.slice(2);
  if (!file) { console.error("usage: node dbxhash.mjs <file> [expected_hash]"); process.exit(2); }
  // An expected hash may arrive with spaces, a newline or a "sha256:" prefix; an EMPTY one is an error, not a pass.
  const expected = expectedRaw === undefined ? undefined : expectedRaw.trim().replace(/^sha256:/i, "").toLowerCase();
  if (expected !== undefined && !/^[0-9a-f]{64}$/.test(expected)) { console.error("expected hash must be 64 hex characters"); process.exit(2); }
  try {
    const { size, hash } = dropboxHashOfFile(file);
    console.log(`${hash}  ${size} bytes  ${file}`);
    if (expected !== undefined) {
      const ok = hash === expected;
      console.log(ok ? "MATCH" : "MISMATCH");
      process.exit(ok ? 0 : 1);
    }
  } catch (e) { console.error(`cannot read ${file}: ${e.code || e.message}`); process.exit(2); }
}
