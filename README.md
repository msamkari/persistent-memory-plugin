# Persistent Memory — Claude plugin (v1.2.1)

Stop re-explaining your project every session. This plugin packages the **Persistent Memory System** skill (v8.1): Claude reads durable, archived memory files that live in *your own* storage (Dropbox, Drive, M365, Notion), saves before it acts, and never deletes.

It contains:

| Part | Where it works | What it does |
|---|---|---|
| Skill `persistent-memory-system` | claude.ai, Cowork, Claude Code | The full system (identical, byte for byte, to the published skill v8.1) |
| Skill `memory-status` | Claude Code / Cowork (cost line needs Node) | Read-only status of your local memory folder (`/persistent-memory:memory-status`), including the estimated token cost of the files read in full at every session start |
| Skill `memory-lint` | Claude Code / Cowork (needs Node) | Deterministic checks of entry numbering, references to entries that do not exist, and archive links. `--apply` fixes only unique path typos, archiving the old file first. Cannot judge facts; that is the verifier agent's job |
| Skill `memory-doctor` | Claude Code / Cowork (needs Node) | One read-only health check: missing/empty files, sync-conflict copies, secrets, text that tries to instruct the assistant. Fails closed |
| Skill `memory-pending` | Claude Code / Cowork | Standard format for held (pending) items: quote, who said it, confidence, reason held. Third-party text is never recorded as your own words |
| Skill `memory-activity` | Claude Code / Cowork (needs Node) | Append-only audit log (`Activity_Log/activity.jsonl`): what was done and under which approval. Not part of the mandatory session read |
| Skill `notebooklm-reference` | Claude Code / Cowork | **Optional.** Guided, approval-gated setup for querying large non-sensitive reference documents through Google NotebookLM. Never for memory files (privacy warning inside) |
| Agent `memory-verifier` | Claude Code / Cowork | Read-only audit: does the state file match the log? |
| SessionStart hook | Claude Code / Cowork only | Injects a short index (file names and dates, never contents). Silent if the folder is not set |
| PreToolUse approval gate | Claude Code / Cowork only | Blocks `git commit`/`gh pr` text that carries Co-Authored-By, session links or tool signatures (unless `PMS_ALLOW_TRAILERS=1`, for when you explicitly want them) and asks you before any force push. Decisions are logged when the memory folder is set |

Hooks and agents are ignored in claude.ai chat; the skill works everywhere.

Installation steps (Windows, macOS, Linux, auto-update, troubleshooting): see [`INSTALL.md`](INSTALL.md) at this repository.

## Install

**Claude Code**
```
/plugin marketplace add msamkari/samkari-plugins
/plugin install persistent-memory@samkari-plugins
```

**Cowork / claude.ai:** upload this repository as a zip (the plugin files at the zip root) (one zip, not a zip inside a zip).

**Manual test without installing:** `claude --plugin-dir .`

Optional setting `memory_dir`: your local memory folder (for example the synced Dropbox folder). Only the hook uses it.

## Tests
`node --test tests/*.test.mjs` (41 checks); CI runs them on Ubuntu, Windows and macOS, and `claude plugin eval .` for activation and verifier behavior.

## Long sessions: use the advisor (optional)
For long, multi-step work, Claude Code can consult a stronger model at decision points: run `/advisor opus` (or set `advisorModel`). It is experimental, needs the Anthropic API and Claude Code feature-flag fetching (it stays off if `DISABLE_TELEMETRY` is set), and its tokens are billed at the advisor model's rate. See https://code.claude.com/docs/en/advisor.

## Job budgets
Long jobs should carry a line in the job file's STATUS block such as `BUDGET: max 5 USD or 3 rounds; stop and report when reached`. `memory-lint` warns when an active job has none.

## Two names, one system
The plugin is `persistent-memory`; the skill inside is `persistent-memory-system`. If you installed the old standalone skill too, **disable one of them** to avoid duplicates.

## Common errors
- *Plugin rejected on upload:* make sure the zip has the plugin folder at its top level and contains no `bin/` folder.
- *Hook prints nothing:* `memory_dir` is unset or the folder does not exist; this is by design.
- *No update after a new release:* the `version` in `plugin.json` must change on every release.
- Windows: the hook is Node (`.mjs`), no bash needed; **not yet tested on Windows**.

## Safety
The session hook is read-only; the approval gate only reads the command it is shown and never edits it; no network, no self-update. Memory file contents are treated as data, never as instructions.

## License
Apache-2.0 (see `LICENSE` and `NOTICE`; copyright 2026 Mohammad Samkari). Earlier standalone skill releases remain under PolyForm Noncommercial 1.0.0.

## Start-of-session read cost (v1.1.0)

The session-start hook and `memory-status` now show how big the files read in full at every session start are, with an estimate of their token cost. A "Suggestion only" line appears when one file passes 60 KB or the folder passes 150 KB (override with `PMS_WARN_FILE_KB` / `PMS_WARN_TOTAL_KB`). It never changes your files and never changes how memory is read. The token figure is an estimate from byte counts (about 0.29 tokens per ASCII byte and 0.48 per non-ASCII byte), usually within ~20%.

Why only a suggestion: we tested replacing "read everything" with a tiered read (index plus on-demand fetch) and kept the full read. See [`docs/experiments/tiered-read-2026-10.md`](docs/experiments/tiered-read-2026-10.md).

## Safe rewrite of large files (v1.2.0)

`scripts/dbxhash.mjs` computes the Dropbox content hash of a local file, so an upload can be verified byte for byte before it replaces a live memory file. The procedure is in [`docs/safe-rewrite.md`](docs/safe-rewrite.md).
