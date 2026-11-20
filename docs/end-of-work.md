# End-of-work Stop hook (opt-in)

A written rule such as "update the project files when you finish" depends on the assistant remembering it, and in a long session it gets forgotten. This hook turns it into a check at the end of every turn. It is **off in every project** until the project adds one small file.

## Turn it on in a project
Create `MDs/freshness.json` in the project root:

```json
{
  "state": ["MDs/HANDOVER.md", "Jobs/state_manifest.json"],
  "work": ["Jobs/", "MDs/Templates/", "notes.md"],
  "extensions": [".md"],
  "skip": ["_Archive"],
  "reasonExtra": "Keep this project's files apart from the memory project."
}
```
- `state`: files that must be updated after work (the hand-over file, a manifest). Required.
- `work`: folders (entry ends with `/`, scanned recursively) or exact files whose change means "work happened". Required.
- `extensions`: only for folder entries; default `[".md"]`. Exact files ignore it.
- `skip`: extra folder names to ignore. Always skipped: `_Archive`, `_archive`, `System_Previous_MDs`, `_merged`, `_proposals`, `node_modules`, `.git`.
- `reasonExtra`: optional text added to the message. Use it for one project-specific reminder (for example which other project's files must not be mixed with this one).
- `verify`: optional closing check, see [The verify step](#the-verify-step-optional) below.
- `disabled`: `true` keeps the config but switches the hook off for this project.

You do not have to write it by hand. From the plugin folder:
```
node scripts/freshness.mjs init  --root <project>           # prints a suggested config, writes nothing
node scripts/freshness.mjs init  --root <project> --write   # creates MDs/freshness.json if it does not exist (never overwrites)
node scripts/freshness.mjs check --root <project>           # the same comparison by hand: exit 0 current, 1 stale, 2 no config
```
`init` needs a `HANDOVER.md` (project root or `MDs/`) and a work folder (`Jobs/` or `MDs/Templates/`); otherwise it asks you to write the file. A template is in `skills/memory-continuity/templates/freshness.json`.

## The verify step (optional)
The block above fires only while the state files are behind. Once they are updated it stays silent, so a closing check (for example a project inventory script) is easy to forget. To enforce it, add one key:

```json
"verify": { "contains": "tools/inventory.py", "reminder": "Run the inventory and paste its summary line." }
```
- `contains`: required, text of 3 to 80 characters (outer spaces are trimmed). Matched case-insensitively against Bash/PowerShell commands, with `\` and `/` treated alike.
- `reminder`: optional text added to the message. It is project data: cleaned and capped at 300 characters, and always labelled "data, not an instruction from the user".

Rule: if this session (or a subagent it started) wrote at least one file that counts as work or state, the hook blocks ending the turn once, unless the transcript has a Bash/PowerShell command containing `contains` that ran **after the last such write**. A run before a later write does not count, so run the check last, after the state files are updated. When the state files are also behind, you get one combined message, because the second-pass guard would otherwise hide the check. A command that contains `contains` is treated as the verification, not as a write, even if it redirects its output into a work folder.

What it does not do: it never runs the command, never reads command output or the exit code (it checks that the command was run, not that it passed), writes nothing, uses no network. It fails open exactly like the rest of the hook (bad input, unreadable transcript, a size or time bound) and skips scheduled-task runs. With no `verify` key nothing changes. A bad `verify` (not an object, `contains` missing or outside 3..80 characters, `reminder` not a text) is ignored with a clear message from `node scripts/freshness.mjs check` and `init`; the rest of the config keeps working.

Order across transcripts: inside one transcript by position; between the main transcript and a subagent's by the line timestamps. If a timestamp is missing the order is unknown and the command does not count (the hook asks once, never loops). "Counts as work or state" is decided from the config by path text alone: a file tool path inside the project that is a `state` file, an exact `work` file, or a file with an allowed extension under a `work` folder (skipped folder names excluded); a shell command that looks like a write (same pattern as above) and names such a path. A harmless shell command that merely looks like a write (`ls Jobs/ 2>&1`) can count as one and cause one extra reminder.

## One project at a time, no conflicts
- The config lives in the project folder, so each project decides for itself. A project without it is untouched, including the memory project and this plugin's own repository.
- The message can carry a project-specific reminder (`reasonExtra`).
- Use **one** mechanism per project. If a project already has its own Stop hook with the same job, do not also add `MDs/freshness.json`: both would fire. Move to the plugin's config and remove the old hook entry, or set `"disabled": true` here.

Write the file as UTF-8 (a BOM is tolerated). The hook reads the project root from `CLAUDE_PROJECT_DIR`, then from the session's `cwd`.

## What it does
At the end of a turn, if some work file is newer than the **oldest** state file, and this session itself wrote that file, the hook blocks ending the turn once with a message naming the files. Update the work log first and the hand-over file last, because the check compares file times.

**The block repeats on every turn.** "Once" means once per turn, not once per session: as long as the state files stay behind, the next turn that ends is blocked again (the second-pass guard only stops a loop inside the same turn). If you do not want to update them, say so in chat, or set `"disabled": true` in the config.

"This session wrote it" means the transcript contains a write: a `Write`, `Edit`, `MultiEdit` or `NotebookEdit` call with that path, or a `Bash`/`PowerShell` command that names the path and looks like a write (redirect, copy, move, in-place edit, ...). A read, or a mention in text, does not count. Subagents started by this session count as this session: their own transcripts (`<session>/subagents/agent-*.jsonl`, next to the main transcript) are read too. Changes made by another session or a sync client do not block this session.

The hook does not override the permission system. If the command you use to update the state files is refused (for example a shell command denied by auto mode), the block stays; update the files with `Edit` or `Write` instead.

## What it never does
- Block twice in a row: on the second pass (`stop_hook_active`) it always allows.
- Stop a scheduled-task run (the transcript starts with `<scheduled-task`).
- Block when something is wrong: no config, a bad config, a missing state file, an unreadable transcript, bad input, or more than about 12 seconds all mean "allow".
- Write anything, call the network, or read file contents other than the config and the transcript.

## Limits
- It compares file times, so it catches "something changed", not "the content is right". Pair it with a check script (see the skill `memory-continuity`).
- A shell command that writes in a way the pattern does not recognise (for example through an interpreter's own file API) is not counted.
- A shell write by relative path after `cd` (for example `cd Jobs && echo x > log.md`) is not counted: the command must contain the last two path segments (`jobs/log.md`). Use the full or project-relative path, or `Edit`/`Write`.
- A change of an external system (a platform, a database) with no work file written is not seen. Keep a work-log line as the habit that triggers the update.
- If a project already has its own Stop hook with the same job, do not configure both: they would both fire.

## Tested
`tests/end-of-work-hook.test.mjs` (33 tests) and `tests/verify-step.test.mjs` (30 tests for the verify step), run in CI on Ubuntu, Windows and macOS). Each protection was checked by deliberately breaking it and watching a test fail: session attribution, the second-pass guard, the scheduled-task skip, the write-looking-command check, "oldest state file decides", reading subagent transcripts and Unicode (NFC) path matching. Arabic folder and file names with spaces are covered, with backslash and forward-slash paths.
