# Changelog

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
