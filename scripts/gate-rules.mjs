// Pure decision rules for the approval gate (no I/O), unit-tested. The gate can only return "deny" or "ask", never "allow":
// it cannot approve a command, it can only stop one or ask the user.
//
// Two layers, OR-ed together so nothing the old plain-text rules caught is lost:
//  1. the original regexes over the raw command text;
//  2. a small linear tokenizer (no backtracking, no nested quantifiers) that understands quotes, command
//     separators, git options that take a separate value (-C dir, -c k=v, --git-dir, --work-tree), git.exe,
//     combined short flags (-fu), +refspec pushes, and bash/sh/powershell -c wrappers.
// It is still advisory: aliases (git pf), variables ($GIT), assembled strings and eval of built text cannot be seen.
const SIGNATURE = /Co-Authored-By\s*[:=：]|Claude-Session\s*[:=：]|claude\.ai\/code\/session|Generated\s+with\s+\[?Claude\s+Code/i;
const LEGACY_PUBLISH = /\bgit\s+(?:-\S+\s+)*(?:commit|tag)\b|\bgh\s+pr\s+(?:create|edit)\b/;
const LEGACY_FORCE = /\bgit\s+(?:-\S+\s+)*push\b[^|;&\n]*\s(?:--force(?:-with-lease)?(?:=\S+)?|-f)(?:\s|$)/;

const MAX_LEGACY = 20_000;       // the plain regexes can backtrack quadratically on huge hostile input: only run them on normal-sized commands
const MAX_ANALYZE = 1_000_000;   // longer commands: only the legacy regexes (fail open, stay fast)
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "powershell", "pwsh", "cmd", "eval", "iex", "invoke-expression"]);
const EVALS = new Set(["eval", "iex", "invoke-expression"]);
const SHELL_C = new Set(["-c", "-lc", "-ic", "-command", "-c:", "/c", "/k"]);
const GIT_VALUE_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--config-env", "--attr-source"]);
const GH_VALUE_OPTS = new Set(["-R", "--repo", "--hostname"]);
const GIT_TEXT_SUBS = new Set(["commit", "tag", "merge", "notes"]);          // subcommands that write a message
const GH_PUBLISH = { pr: ["create", "edit", "merge", "review", "comment"], issue: ["create", "edit", "comment"], release: ["create", "edit"] };

const baseName = (t) => t.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "").toLowerCase();
const isPrefix = (word, n, min) => n.length >= min && word.startsWith(n); // an unambiguous abbreviation of a long option

// Splits a command into segments (at ; | & newline ( ) { } and, outside PowerShell, backtick) of unquoted tokens.
// A redirect (< >) ends the token. In PowerShell mode a backtick is the escape character. Linear time.
export function tokenize(cmd, ps = false) {
  const segs = []; let toks = []; let cur = ""; let has = false; let q = "";
  const endTok = () => { if (has) { toks.push(cur); cur = ""; has = false; } };
  const endSeg = () => { endTok(); if (toks.length) { segs.push(toks); toks = []; } };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q === "'") { if (c === "'") q = ""; else { cur += c; } continue; }
    if (q === '"') {
      if ((c === "\\" || (ps && c === "`")) && i + 1 < cmd.length) { cur += cmd[++i]; continue; }
      if (c === '"') q = ""; else cur += c;
      continue;
    }
    if (c === "\\" && (cmd[i + 1] === "\n" || (cmd[i + 1] === "\r" && cmd[i + 2] === "\n"))) { i += cmd[i + 1] === "\r" ? 2 : 1; endTok(); continue; } // line continuation
    if (ps && c === "`" && i + 1 < cmd.length) { const n = cmd[i + 1]; if (n === "\n" || n === "\r") { endTok(); i += (n === "\r" && cmd[i + 2] === "\n") ? 2 : 1; } else { cur += n; has = true; i++; } continue; }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === ";" || c === "|" || c === "&" || c === "\n" || c === "(" || c === ")" || c === "{" || c === "}" || (!ps && c === "`")) { endSeg(); continue; }
    if (c === "<" || c === ">" || c === " " || c === "\t" || c === "\r") { endTok(); continue; }
    cur += c; has = true;
  }
  endSeg();
  return segs;
}

// Push words that rewrite or delete published history: --force and abbreviations of --force-with-lease, -f, --mirror,
// --delete / -d, --prune, a +refspec and a :refspec (delete).
function dangerousPushArg(a) {
  if (a.length > 1 && (a[0] === "+" || a[0] === ":")) return true;
  if (a.startsWith("--")) {
    const n = a.slice(2).split("=")[0].toLowerCase();
    return isPrefix("force-with-lease", n, 5) || isPrefix("force-if-includes", n, 5) || isPrefix("mirror", n, 2) || isPrefix("delete", n, 2) || isPrefix("prune", n, 3);
  }
  return /^-[A-Za-z]*[fd][A-Za-z]*$/.test(a);
}
const isShellC = (b, x) => {
  const l = x.toLowerCase();
  if (SHELL_C.has(l)) return true;
  if (b === "powershell" || b === "pwsh") return /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?:?$/.test(l);
  return /^-[a-z]+c$/.test(l); // bash -ec, sh -euc, bash -xc
};
const isEncoded = (x) => { const l = x.toLowerCase(); return l.length >= 2 && l[0] === "-" && "-encodedcommand".startsWith(l); };

function analyzeSegment(t, f, depth, ps) {
  const d = t.map((x) => (x.includes("\\") ? x.replace(/\\/g, "") : x)); // a backslash inside a word (g\it, -\f) is dropped by the shell
  const isCmd = (i, n) => baseName(t[i]) === n || baseName(d[i]) === n;
  const another = (j) => isCmd(j, "git") || isCmd(j, "gh");
  let i = 0, wrapperDone = false;
  while (i < t.length) {
    const b = baseName(d[i]);
    if (isCmd(i, "git")) {
      let j = i + 1;
      while (j < t.length && d[j].startsWith("-")) j += GIT_VALUE_OPTS.has(d[j]) ? 2 : 1;
      const sub = (d[j] || "").toLowerCase();
      j++;
      if (GIT_TEXT_SUBS.has(sub)) {
        f.publishes = true;
        // find a message that lives in a file the gate cannot read; skip the value of -m
        while (j < t.length && !another(j)) {
          const a = d[j];
          if (a === "-m" || a === "--message" || /^-[A-Za-z]*m$/.test(a)) { j += 2; continue; }
          if (/^-[A-Za-z]*F$/.test(a)) f.fileMessage = true;
          else if (a.startsWith("--")) { const n = a.slice(2).split("=")[0].toLowerCase(); if (isPrefix("file", n, 1)) f.fileMessage = true; }
          j++;
        }
      } else if (sub === "push") {
        while (j < t.length && !another(j)) {
          if (dangerousPushArg(d[j])) f.force = true;
          j++;
        }
      }
      i = Math.max(j, i + 1); continue;
    }
    if (isCmd(i, "gh")) {
      let j = i + 1; const pos = [];
      while (j < t.length && pos.length < 2 && !another(j)) {
        if (d[j].startsWith("-")) j += GH_VALUE_OPTS.has(d[j]) ? 2 : 1; else { pos.push(d[j].toLowerCase()); j++; }
      }
      const [a1 = "", a2 = ""] = pos;
      const isPub = Object.hasOwn(GH_PUBLISH, a1) && GH_PUBLISH[a1].includes(a2), isApi = a1 === "api";
      if (isPub) f.publishes = true;
      if (isPub || isApi) {
        while (j < t.length && !another(j)) {
          const a = d[j], nx = d[j + 1] || "";
          if (isPub && (a === "--body-file" || a === "-F" || a === "--notes-file" || a.startsWith("--body-file=") || a.startsWith("--notes-file="))) f.fileMessage = true;
          if (isApi) {
            if ((/^(?:-f|-F|--field|--raw-field)$/.test(a) && /^body=/.test(nx)) || /^(?:-[fF]|--field=|--raw-field=)body=/.test(a)) { f.apiBody = true; f.publishes = true; }
          }
          j++;
        }
      }
      i = Math.max(j, i + 1); continue;
    }
    if (SHELLS.has(b) && !wrapperDone) {
      wrapperDone = true; // only the first wrapper in a segment is unwrapped: keeps the work linear
      if (depth < 3) {
        if (EVALS.has(b)) analyze(d.slice(i + 1).join(" "), f, depth + 1, ps);
        else {
          const k = d.findIndex((x, n) => n > i && isShellC(b, x));
          const e = (b === "powershell" || b === "pwsh") ? d.findIndex((x, n) => n > i && isEncoded(x)) : -1;
          if (k >= 0) analyze(d.slice(k + 1).join(" "), f, depth + 1, ps);
          else if (e >= 0 && d[e + 1] && d[e + 1].length <= 200_000) {
            try { analyze(Buffer.from(d[e + 1], "base64").toString("utf16le"), f, depth + 1, ps); } catch { /* not base64 */ }
          } else for (let n = i + 1; n < t.length; n++) if (/\s/.test(t[n])) analyze(t[n], f, depth + 1, ps); // bash <<< "git push -f"
        }
      }
    }
    i++;
  }
}
function analyze(cmd, f, depth = 0, ps = false) {
  if (cmd.length > MAX_ANALYZE) return;
  for (const seg of tokenize(cmd, ps)) analyzeSegment(seg, f, depth, ps);
}

// The command with quote characters, backslashes, backticks and zero-width characters removed and whitespace collapsed:
// a quote-split signature and a backslash-split one become the plain signature text.
const deobfuscate = (cmd) => cmd.replace(/["'`\\​-‏⁠﻿]/g, "").replace(/\s+/g, " ");

export function decide(cmd, env = { PMS_ALLOW_TRAILERS: process.env.PMS_ALLOW_TRAILERS }) {
  if (typeof cmd !== "string" || !cmd) return null;
  const f = { publishes: false, force: false, fileMessage: false, apiBody: false };
  try { analyze(cmd, f); if (cmd.includes("`")) analyze(cmd, f, 0, true); } catch { /* the tokenizer must never break the gate: fall back to the plain rules */ }
  const publishes = f.publishes || (cmd.length <= MAX_LEGACY && LEGACY_PUBLISH.test(cmd));
  let signature = SIGNATURE.test(cmd);
  if (!signature && cmd.length <= MAX_ANALYZE) { try { signature = SIGNATURE.test(deobfuscate(cmd)); } catch { /* keep the raw result */ } }
  const allowed = env.PMS_ALLOW_TRAILERS === "1";
  if (publishes && signature && !allowed)
    return { decision: "deny", rule: "no-trailers",
      reason: "Blocked by persistent-memory approval gate: no Co-Authored-By, session link or tool signature in commits/PRs unless the user explicitly asked for it. Remove it, or ask the user first." };
  if (f.force || (cmd.length <= MAX_LEGACY && LEGACY_FORCE.test(cmd)))
    return { decision: "ask", rule: "force-push",
      reason: "Force push rewrites published history. It needs the user's explicit approval." };
  if ((f.fileMessage || f.apiBody) && !allowed)
    return { decision: "ask", rule: "unseen-message",
      reason: "The commit/PR text is read from a file or an API field, so the gate cannot check it for a Co-Authored-By line, session link or tool signature. Confirm it has none (or that the user asked for it)." };
  return null;
}
