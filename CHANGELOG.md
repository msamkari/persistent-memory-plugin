# Changelog

## 1.5.0 (2026-10-29)
- Added an opt-in Stop hook, `hooks/end-of-work.mjs`. It is silent in every project unless that project has `MDs/freshness.json` (state files and work files, see `docs/end-of-work.md`). When it is configured and this session wrote a work file after the state files (HANDOVER, manifest, ...) were last updated, the hook blocks ending the turn once and names the files. It never blocks twice (`stop_hook_active`), never stops scheduled-task runs, counts only files this session wrote (parsed from the transcript's tool calls, not mere mentions or reads), and fails open on any error, bad config, missing file or time bound.
- Added `scripts/freshness.mjs` (shared logic, read-only, no network) with two commands: `init` (prints a suggested `MDs/freshness.json`; `--write` creates it only if absent, never overwrites) and `check` (the same comparison by hand, exit 0/1/2). Config key `disabled: true` switches the hook off per project.
- Skill `memory-continuity`: new optional step 6 (ask first), template `templates/freshness.json`, and a HANDOVER template section "Keeping these files current". The main skill file is unchanged.
- Added `tests/end-of-work-hook.test.mjs` (24 tests, in CI; each protection was checked by deliberately breaking it); 91 tests in total.
- Why: an "update the project files when you finish" rule written only in prose was forgotten in long sessions, and a file-structure inventory said "pass" while the state files were stale.
- Not changed: the SessionStart hook, the approval gate, the main skill `persistent-memory-system`, `memory_dir`. Without `MDs/freshness.json` nothing happens.

## 1.4.0 (2026-10-28)
- The SessionStart hook now also names the project hand-over file: if `HANDOVER.md` (project root) or `MDs/HANDOVER.md` exists, one line with its path tells a new chat to read it first. Only the path is injected, never the file text; the line is kept when the index is trimmed. It works even when no memory folder is set. Without a hand-over file nothing changes.
- Added `tests/handover-hook.test.mjs` (6 tests, in CI); 67 tests in total.

## 1.3.0 (2026-10-28)
- Added skill `memory-continuity` (additive, no behavior change): HANDOVER.md and CLAUDE.md pointer templates, a configurable Node inventory/manifest template, a mutation-test guide, and a cold-start test protocol that uses the existing read-only `memory-verifier` (no new agent).
- Added `docs/continuity.md`: proposal archive (`_proposals` to `_merged` with INDEX and hash), `vN` version names, closing overtaken scheduled tasks, agent tools do not inherit MCP, Windows hints.
- README: advisor budget line. Added `tests/continuity.test.mjs` (also pins the main skill by hash) and added it to CI.
- Not changed: `skills/persistent-memory-system/SKILL.md`, hooks, existing scripts. Pointing the SessionStart hook at HANDOVER.md is a possible later change.

## 1.2.1 (2026-10-23)
- Removed a stray `L/` folder (eight scratch files from a review test) that was committed into 1.1.0 by mistake. No plugin behavior changed.
- Added `tests/layout.test.mjs` (run in CI): fails if a tracked top-level entry is not on the known list, or a tracked path is over 120 characters.

## 1.2.0 (2026-10-23)
- Added `scripts/dbxhash.mjs`: Dropbox content hash of a local file, with an optional expected hash (exit 0 match, 1 mismatch, 2 error). Read-only, no network.
- Added `docs/safe-rewrite.md`: how to rewrite a large memory file without silent corruption (stage, compare hash, then two moves).
- 6 new tests (39 total); vectors computed independently. Review fixes: tolerant expected hash, empty or malformed expected hash is an error, non-regular files refused, short reads handled.

## 1.1.0 (2026-10-23)
- Added `scripts/cost.mjs`: estimated start-of-session read cost of `MDs/System_Current_MD` (read-only, no network).
- The SessionStart hook now adds a cost line and, past a threshold, a suggestion-only warning. Contents are still never injected.
- `memory-status` shows the same figures.
- Documented the tiered-read experiment and why the full read is kept (`docs/experiments/tiered-read-2026-10.md`).
- The cost estimate reads at most 1 MB per file (size from stat), skips unreadable files instead of failing, and the hook keeps the cost line and the reminder when names are long.
- No change to how memory is read, written or archived.

## 1.0.0 (2026-10-21)
- First stable release. Plugin moved to its own repository (previously a subfolder of persistent-memory-system-skill, versions 0.1.0 to 0.4.1).
