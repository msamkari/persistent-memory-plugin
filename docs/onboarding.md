# One install, every project (added in v1.7.0)

Install the plugin once, for yourself (user scope). It then serves every folder you open. A project never gets a copy of the plugin's scripts: it only holds its own plain files and small config files.

## The offer at session start
When a session starts in a folder that looks like a project and has no memory system, the SessionStart hook adds one short note to Claude's context. Claude then offers, in one sentence, to set the project up. That is all the hook does: it creates nothing in the project.

| Situation | What the hook prints |
|---|---|
| A memory folder is set (`memory_dir`) | the index, exactly as before; no offer |
| The project has `HANDOVER.md` or `MDs/HANDOVER.md` | the hand-over line, exactly as before; no offer |
| The project (or a parent folder) has `MDs/System_Current_MD`, `MDs/freshness.json`, `Jobs/state_manifest.json` or a `Persistent_Memory_System` folder | nothing, as before |
| Not a project: your home folder, anything above it, a drive root, Desktop / Documents / Downloads / the root of a sync folder, hidden and application-data folders, system folders, a folder with no files | nothing |
| The plugin's data folder is unknown or cannot be written | nothing (a "no" could not be remembered, so it does not ask) |
| First session in a project without a memory system | the offer, once |
| Any later session in that project | nothing |

"Looks like a project" means: a known marker at the top level (`.git`, `.claude`, `CLAUDE.md`, `AGENTS.md`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `README.md`, `Jobs`, `MDs`) or at least one visible file there. Only names are read, at most 400 of them; no file is opened.

## What is remembered, and where
Before it prints the offer, the hook writes one small file in the plugin's own data folder (`CLAUDE_PLUGIN_DATA`, which Claude Code gives to plugin hooks): `onboarding/<hash>.json` with `{"v":1,"state":"offered","at":"<date>"}`. The file name is a hash of the folder path, so no project name or path is stored. If that file cannot be written, the offer is not shown.

Nothing is written inside the project unless you accept the setup in chat.

Commands (the skill `memory-setup` runs them for you; `--data` is the plugin data folder):
```
node scripts/onboarding.mjs status  --root <project> --data <data folder>   # what is recorded, and whether an offer would be shown
node scripts/onboarding.mjs decline --root <project> --data <data folder>   # record "no" for this project
node scripts/onboarding.mjs reset   --root <project> --data <data folder>   # forget the answer: the offer may appear once more
node scripts/onboarding.mjs off     --data <data folder>                    # no offers in any project (undo: on)
```
Environment switch: `PMS_SETUP_OFFER=off` silences the offer everywhere. `PMS_SETUP_OFFER=always` also shows it (at most twice per project) to users who have set a memory folder; by default those users see no change at all.

## The setup (only after you say yes)
```
node scripts/setup.mjs init --root <project>            # prints the plan, writes nothing
node scripts/setup.mjs init --root <project> --write    # creates what is missing; never overwrites
```
Options: `--lang ar` (Arabic file text), `--no-freshness` (do not turn on the end-of-work check), `--show` (print the file bodies with the plan).

| Created if missing | What it is |
|---|---|
| `MDs/HANDOVER.md` | one "Start here" block that a new chat reads first (the session hook names its path) |
| `Jobs/series_log.md`, `Jobs/state_manifest.json` | the work log and the current state |
| `MDs/System_Current_MD/`, `MDs/System_Previous_MDs/` | the memory files and their archive, empty; the skill `persistent-memory-system` fills them |
| `Jobs/_Archive/`, `MDs/archive.json` | where old versions go before a file is replaced |
| `MDs/freshness.json` | turns on the end-of-work Stop hook for this project (see [`end-of-work.md`](end-of-work.md)) |

The setup refuses your home folder and system folders. A hand-over file that already sits in the project root is kept and used.

## Archive before write
```
node scripts/archive.mjs copy <file> --root <project>           # prints where the copy would go
node scripts/archive.mjs copy <file> --root <project> --write   # copies, then checks the copy (SHA-256)
node scripts/archive.mjs init --root <project> [--write]        # starter MDs/archive.json; never overwrites
```
`MDs/archive.json`:
```json
{
  "first": "a",
  "rules": [
    { "from": "MDs/System_Current_MD/", "to": "MDs/System_Previous_MDs/", "byMonth": true },
    { "from": "MDs/", "to": "MDs/System_Previous_MDs/" },
    { "from": "Jobs/", "to": "Jobs/_Archive/" }
  ]
}
```
- The first rule whose `from` is a prefix of the file's path wins. `byMonth` adds a `YYYY-MM` folder.
- Names: `<name>_YYYY-MM-DD` plus a letter. `"first": "a"` gives `a`, `b`, `c` for the copies of one day. `"first": "plain"` gives no letter for the first copy, then `b`, `c`; this is the naming of the main skill and the default when the project has no `MDs/archive.json`.
- An existing archive copy is never overwritten, the original is never changed or deleted, and a file outside the project is refused. A broken config stops the copy instead of guessing.
- `memory-lint --apply` keeps its own archive step (`_prelint` names); it is unchanged.

## Optional companion: vitals
[`vitals`](https://github.com/msamkari/vitals) is a separate plugin: an offline check that required files exist and that the state files are not older than the work. This plugin does not need it and never installs it. During setup Claude asks whether you want a starter config if `vitals` is installed (it prints a proposal with `--init` and writes `Jobs/inventory.config.json` only after you agree), and otherwise mentions once how to install it: `/plugin install vitals@samkari-plugins`.

## Limits
- The offer is shown once, plus one reminder after 14 days if nobody answered (a second marker file, `<hash>.2.json`, written with exclusive create). A "no" (`decline`) is never reminded. If the first session was unattended (a scheduled or non-interactive run), nobody saw it; use the skill `memory-setup` by name, or `reset`.
- Whether Claude actually says the sentence is model behaviour; the hook only supplies the note.
- A folder with a single stray file can get the offer once.
- Moving or renaming a project folder makes it a new project for this purpose.
