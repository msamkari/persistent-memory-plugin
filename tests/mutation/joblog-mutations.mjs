// Manual check (not part of `node --test`, it takes about a minute): break scripts/joblog.mjs on purpose in many
// ways and confirm that tests/joblog.test.mjs notices every one. Usage: node tests/mutation/joblog-mutations.mjs
// The script file is restored afterwards, also when this run is interrupted by an error.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const file = path.join(root, "scripts", "joblog.mjs");
const original = fs.readFileSync(file, "utf8");

// [name, text to find, replacement]. "known" = a protection no test can trigger (a partial write cannot be simulated here).
const MUTATIONS = [
  ["accept '..' parts", 'p === "" || p === "." || p === ".."', 'p === ""'],
  ["accept any top folder", "if (!ALLOWED_DIRS.includes(parts[0].toLowerCase()))", "if (false)"],
  ["accept any extension", "if (!ALLOWED_EXT.includes(", "if (false && !ALLOWED_EXT.includes("],
  ["accept a symlinked file", 'if (lst.isSymbolicLink()) refuse("the file is a symbolic link");', ""],
  ["accept a symlinked folder", "if (st.isSymbolicLink()) refuse(`${seg} is a symbolic link`);", ""],
  ["accept ':' in paths", 'if (r.includes(":")) refuse(', "if (false) refuse("],
  ["accept absolute paths", 'if (r.startsWith("/") || /^[A-Za-z]:/.test(r) || r.startsWith("//")) refuse(', "if (false) refuse("],
  ["drop the append flag", "C.O_RDWR | C.O_APPEND | NOFOLLOW", "C.O_RDWR | NOFOLLOW"],
  ["allow line breaks in text", "if (CONTROL.test(t)) refuse(", "if (false) refuse("],
  ["stateful control regex", '[0x2028, 0x2029]], "u");', '[0x2028, 0x2029]], "gu");'],
  ["no length limit", "if ([...t].length > MAX_LINE) refuse(", "if (false) refuse("],
  ["create without --create", "} else if (!create) refuse(", "} else if (false) refuse("],
  ["no missing-newline repair", "if (!tail.endsWith(LF)) prefix = eol;", ""],
  ["ignore CRLF", "if (tail.includes(CRLF)) eol = CRLF;", ""],
  ["accept roots outside the session", "if (!inside) refuse(", "if (false) refuse("],
  ["no hard-link check at open", "if (st.nlink > 1) refuse(", "if (false) refuse(", "known"], // second layer: the first check (before the open) already refuses; only a race could reach this one
  ["no non-UTF-8 file check", "if (buf.includes(0)) refuse(", "if (false) refuse("],
  ["accept U+FFFD", "if (t.includes(BAD_CHAR)) refuse(", "if (false) refuse("],
  ["keep Unicode tag characters", ", [0xe0000, 0xe007f], [0xe0100, 0xe01ef]", ""],
  ["accept lone surrogates", 'if (typeof text.isWellFormed === "function" && !text.isWellFormed())', "if (false)"],
  ["accept the home folder as root", "if (home && real.toLowerCase() === home.toLowerCase()) refuse(", "if (false) refuse("],
  ["strict main-module guard (silent exit through links)", "sameFile(process.argv[1], fileURLToPath(import.meta.url))", "path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)"],
  ["ignore a short write", 'if (written !== data.length) throw new Error("PARTIAL_WRITE");', "", "known"],
];

let caught = 0, survived = [];
try {
  for (const [name, find, repl, kind] of MUTATIONS) {
    if (!original.includes(find)) { survived.push(`${name} (pattern not found: update this list)`); continue; }
    fs.writeFileSync(file, original.replace(find, repl));
    const r = spawnSync(process.execPath, ["--test", path.join(root, "tests", "joblog.test.mjs")], { encoding: "utf8" });
    const failed = r.status !== 0;
    if (failed) caught++; else if (kind !== "known") survived.push(name);
    console.log(`${failed ? "CAUGHT  " : kind === "known" ? "KNOWN   " : "SURVIVED"} ${name}`);
  }
} finally { fs.writeFileSync(file, original); }
const real = MUTATIONS.filter((m) => m[3] !== "known").length;
console.log(`\ncaught ${caught} of ${MUTATIONS.length} (${real} are testable; known gaps are listed as KNOWN)`);
if (survived.length) { console.log("SURVIVED: " + survived.join("; ")); process.exit(1); }
