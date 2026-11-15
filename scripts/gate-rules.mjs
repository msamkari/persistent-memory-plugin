// Pure decision rules for the approval gate (no I/O), unit-tested. The gate can only return "deny" or "ask", never "allow":
// it cannot approve a command, it can only stop one or ask the user.
//
// Two layers, OR-ed together so nothing the old plain-text rules caught is lost:
//  1. the original regexes over the raw command text;
//  2. a small linear tokenizer (no backtracking, no nested quantifiers) that understands quotes, command
//     separators, git options that take a separate value (-C dir, -c k=v, --git-dir, --work-tree), git.exe,
//     combined short flags (-fu), +refspec pushes, and bash/sh/powershell -c wrappers.
// It is still advisory: aliases (git pf), variables ($GIT), assembled strings and eval of built text cannot be seen.
const SIGNATURE = /Co-Authored-By:|Claude-Session:|claude\.ai\/code\/session|Generated with \[?Claude Code/i;
const LEGACY_PUBLISH = /\bgit\s+(?:-\S+\s+)*(?:commit|tag)\b|\bgh\s+pr\s+(?:create|edit)\b/;
const LEGACY_FORCE = /\bgit\s+(?:-\S+\s+)*push\b[^|;&\n]*\s(?:--force(?:-with-lease)?(?:=\S+)?|-f)(?:\s|$)/;

const MAX_LEGACY = 20_000;       // the plain regexes can backtrack quadratically on huge hostile input: only run them on normal-sized commands
const MAX_ANALYZE = 1_000_000;   // longer commands: only the legacy regexes (fail open, stay fast)
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "powershell", "pwsh", "cmd", "eval"]);
const SHELL_C = new Set(["-c", "-lc", "-ic", "-command", "-c:", "/c", "/k"]);
const GIT_VALUE_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--config-env"]);
const GH_VALUE_OPTS = new Set(["-R", "--repo", "--hostname"]);

const baseName = (t) => t.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "").toLowerCase();

// Splits a command into segments (at ; | & newline ( ) and backtick outside quotes) of unquoted tokens. Linear time.
export function tokenize(cmd) {
  const segs = []; let toks = []; let cur = ""; let has = false; let q = "";
  const endTok = () => { if (has) { toks.push(cur); cur = ""; has = false; } };
  const endSeg = () => { endTok(); if (toks.length) { segs.push(toks); toks = []; } };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q === "'") { if (c === "'") q = ""; else { cur += c; } continue; }
    if (q === '"') {
      if (c === "\\" && i + 1 < cmd.length) { cur += cmd[++i]; continue; }
      if (c === '"') q = ""; else cur += c;
      continue;
    }
    if (c === "\\" && (cmd[i + 1] === "\n" || (cmd[i + 1] === "\r" && cmd[i + 2] === "\n"))) { i += cmd[i + 1] === "\r" ? 2 : 1; endTok(); continue; } // line continuation
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === ";" || c === "|" || c === "&" || c === "\n" || c === "(" || c === ")" || c === "`") { endSeg(); continue; }
    if (c === " " || c === "\t" || c === "\r") { endTok(); continue; }
    cur += c; has = true;
  }
  endSeg();
  return segs;
}

function analyzeSegment(t, f, depth) {
  let i = 0, wrapperDone = false;
  while (i < t.length) {
    const b = baseName(t[i]);
    if (b === "git") {
      let j = i + 1;
      while (j < t.length && t[j].startsWith("-")) j += GIT_VALUE_OPTS.has(t[j]) ? 2 : 1;
      const sub = (t[j] || "").toLowerCase();
      j++;
      if (/^(?:commit|tag)\b/.test(sub)) {
        f.publishes = true;
        // find a message that lives in a file the gate cannot read; skip the value of -m
        while (j < t.length && baseName(t[j]) !== "git" && baseName(t[j]) !== "gh") {
          const a = t[j];
          if (a === "-m" || a === "--message" || /^-[A-Za-z]*m$/.test(a)) { j += 2; continue; }
          if (/^-[A-Za-z]*F$/.test(a) || a === "--file" || a.startsWith("--file=")) { if (sub === "commit" || sub === "tag") f.fileMessage = true; }
          j++;
        }
      } else if (sub === "push") {
        while (j < t.length && baseName(t[j]) !== "git" && baseName(t[j]) !== "gh") {
          const a = t[j];
          if (a === "--force" || a === "--force-with-lease" || a.startsWith("--force=") || a.startsWith("--force-with-lease=")
            || /^-[A-Za-z]*f[A-Za-z]*$/.test(a) || (a.length > 1 && a[0] === "+")) f.force = true;
          j++;
        }
      }
      i = Math.max(j, i + 1); continue;
    }
    if (b === "gh") {
      let j = i + 1;
      while (j < t.length && t[j].startsWith("-")) j += GH_VALUE_OPTS.has(t[j]) ? 2 : 1;
      const a1 = (t[j] || "").toLowerCase(), a2 = (t[j + 1] || "").toLowerCase();
      j += 2;
      const isPr = a1 === "pr" && (a2 === "create" || a2 === "edit"), isApi = a1 === "api";
      if (isPr) f.publishes = true;
      if (isPr || isApi) {
        while (j < t.length && baseName(t[j]) !== "git" && baseName(t[j]) !== "gh") {
          const a = t[j], nx = t[j + 1] || "";
          if (isPr && (a === "--body-file" || a === "-F" || a.startsWith("--body-file="))) f.fileMessage = true;
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
      const k = b === "eval" ? i : t.findIndex((x, n) => n > i && SHELL_C.has(x.toLowerCase()));
      if (k >= 0 && depth < 3) { analyze(t.slice(k + 1).join(" "), f, depth + 1); }
    }
    i++;
  }
}
function analyze(cmd, f, depth = 0) {
  if (cmd.length > MAX_ANALYZE) return;
  for (const seg of tokenize(cmd)) analyzeSegment(seg, f, depth);
}

export function decide(cmd, env = { PMS_ALLOW_TRAILERS: process.env.PMS_ALLOW_TRAILERS }) {
  if (typeof cmd !== "string" || !cmd) return null;
  const f = { publishes: false, force: false, fileMessage: false, apiBody: false };
  try { analyze(cmd, f); } catch { /* the tokenizer must never break the gate: fall back to the plain rules */ }
  const publishes = f.publishes || (cmd.length <= MAX_LEGACY && LEGACY_PUBLISH.test(cmd));
  const signature = SIGNATURE.test(cmd);
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
