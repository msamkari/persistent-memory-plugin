#!/usr/bin/env node
// Start-of-session read cost for the Persistent Memory folder. Read-only, no network, writes nothing.
// Usage: node cost.mjs <memory_dir>   (or env CLAUDE_PLUGIN_OPTION_MEMORY_DIR / PMS_MEMORY_DIR)
// Token figures are ESTIMATES (see ESTIMATE_NOTE). Thresholds only produce a suggestion; nothing is changed.
import { readdirSync, statSync, existsSync, openSync, readSync, closeSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Calibrated 2026-10-23 against measured Claude input tokens: ASCII text (mostly English) and
// non-ASCII text (mostly Arabic, 2 bytes per character). Large samples were within ~1%; small ones within ~20%.
export const TOKENS_PER_ASCII_BYTE = 0.29;
export const TOKENS_PER_NONASCII_BYTE = 0.48;
export const ESTIMATE_NOTE = "estimate from byte counts, usually within ~20%";

export function estimateTokens(buf) {
  let ascii = 0, other = 0;
  for (const b of buf) (b < 128 ? ascii++ : other++);
  return Math.round(ascii * TOKENS_PER_ASCII_BYTE + other * TOKENS_PER_NONASCII_BYTE);
}

export function thresholds(env = process.env) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return { fileKB: num(env.PMS_WARN_FILE_KB, 60), totalKB: num(env.PMS_WARN_TOTAL_KB, 150) };
}

// Reads at most SAMPLE_BYTES from the start of a file and scales the ASCII / non-ASCII mix to the
// full size, so one huge file cannot stall the SessionStart hook (10 s timeout). Size comes from stat.
export const SAMPLE_BYTES = 1024 * 1024;
export function estimateFromSample(sample, size) {
  if (size === 0 || sample.length === 0) return 0;
  let other = 0;
  for (const b of sample) if (b >= 128) other++;
  const nonAscii = other / sample.length;
  return Math.round(size * ((1 - nonAscii) * TOKENS_PER_ASCII_BYTE + nonAscii * TOKENS_PER_NONASCII_BYTE));
}
function readHead(path, size) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(Math.min(size, SAMPLE_BYTES));
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n);
  } finally { closeSync(fd); }
}

// Files that the skill reads in full at session start: MDs/System_Current_MD/*.md
// A file that cannot be read is counted in `skipped`, never fatal.
export function measure(dir) {
  const sub = join(dir, "MDs", "System_Current_MD");
  if (!existsSync(sub)) return null;
  const files = [];
  let skipped = 0;
  for (const e of readdirSync(sub, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    try {
      const p = join(sub, e.name);
      const bytes = statSync(p).size;
      files.push({ name: e.name, bytes, tokens: estimateFromSample(readHead(p, bytes), bytes) });
    } catch { skipped++; }
  }
  files.sort((a, b) => b.bytes - a.bytes);
  const bytes = files.reduce((s, f) => s + f.bytes, 0);
  const tokens = files.reduce((s, f) => s + f.tokens, 0);
  return { files, bytes, tokens, skipped };
}

const kb = (n) => (n / 1024).toFixed(1);

export function warnings(m, t = thresholds()) {
  const w = [];
  const big = m.files.filter((f) => f.bytes > t.fileKB * 1024);
  for (const f of big) w.push(`${f.name} is ${kb(f.bytes)} KB (over ${t.fileKB} KB)`);
  if (m.bytes > t.totalKB * 1024) w.push(`total is ${kb(m.bytes)} KB (over ${t.totalKB} KB)`);
  return w;
}

export function summaryLines(m, t = thresholds()) {
  const lines = [`Start-of-session read cost: ${kb(m.bytes)} KB, about ${m.tokens} tokens (${ESTIMATE_NOTE}).`];
  lines.push("Largest: " + m.files.slice(0, 3).map((f) => `${f.name} ${kb(f.bytes)} KB`).join(", "));
  if (m.skipped) lines.push(`${m.skipped} file(s) could not be read and are not counted.`);
  const w = warnings(m, t);
  if (w.length) {
    const shown = w.slice(0, 3).map((x) => (x.length > 120 ? x.slice(0, 117) + "..." : x));
    const more = w.length > 3 ? `; and ${w.length - 3} more` : "";
    lines.push("Suggestion only (nothing is changed): " + shown.join("; ") + more + ". Consider the compression rule in 00_Archiving_Rule, with the user's approval.");
  }
  return lines;
}

function isMain() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isMain()) {
  const dir = process.argv[2] || process.env.CLAUDE_PLUGIN_OPTION_MEMORY_DIR || process.env.PMS_MEMORY_DIR || "";
  const m = dir && existsSync(dir) ? measure(dir) : null;
  if (!m) { console.log(`cannot measure: ${dir ? "MDs/System_Current_MD not found under " + dir : "memory folder path not set (memory_dir)"}`); process.exit(1); }
  console.log(summaryLines(m).join("\n"));
  for (const f of m.files) console.log(`  ${f.name}\t${kb(f.bytes)} KB\t~${f.tokens} tokens`);
}
