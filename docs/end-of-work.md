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
- `reasonExtra`: optional text added to the message.

Write the file as UTF-8 (a BOM is tolerated). The hook reads the project root from `CLAUDE_PROJECT_DIR`, then from the session's `cwd`.

## What it does
At the end of a turn, if some work file is newer than the **oldest** state file, and this session itself wrote that file, the hook blocks ending the turn once with a message naming the files. Update the work log first and the hand-over file last, because the check compares file times.

"This session wrote it" means the transcript contains a write: a `Write`, `Edit`, `MultiEdit` or `NotebookEdit` call with that path, or a `Bash`/`PowerShell` command that names the path and looks like a write (redirect, copy, move, in-place edit, ...). A read, or a mention in text, does not count. Changes made by another session, another agent or a sync client do not block this session.

## What it never does
- Block twice in a row: on the second pass (`stop_hook_active`) it always allows.
- Stop a scheduled-task run (the transcript starts with `<scheduled-task`).
- Block when something is wrong: no config, a bad config, a missing state file, an unreadable transcript, bad input, or more than about 12 seconds all mean "allow".
- Write anything, call the network, or read file contents other than the config and the transcript.

## Limits
- It compares file times, so it catches "something changed", not "the content is right". Pair it with a check script (see the skill `memory-continuity`).
- Work done by a subagent that writes a file without that path appearing in this session's own tool calls is not attributed to this session.
- A shell command that writes in a way the pattern does not recognise (for example through an interpreter's own file API) is not counted.
- A change of an external system (a platform, a database) with no work file written is not seen. Keep a work-log line as the habit that triggers the update.
- If a project already has its own Stop hook with the same job, do not configure both: they would both fire.

## Tested
`tests/end-of-work-hook.test.mjs` (18 tests, run in CI on Ubuntu, Windows and macOS). Each protection was checked by deliberately breaking it and watching a test fail: session attribution, the second-pass guard, the scheduled-task skip, the write-looking-command check, and "oldest state file decides".
