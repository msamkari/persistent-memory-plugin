<!-- Template. Replace every <placeholder>. Write it in the language the owner uses. No secrets, tokens or passwords in this file. -->
# HANDOVER: <project name> (read this first in any new conversation)
Last updated: <YYYY-MM-DD>. Owner: <name>. Reply language: <language, tone>. Never publish, send or delete anything without an explicit request.

## 1) What the project is
<Two to four lines: purpose, audience or client, main outputs, where the system files live and where the work log lives.>

## 2) First 5 steps in a new conversation
1. Run the inventory: `node <path>/continuity-inventory.mjs` from the project root. Success = "PASS n of n". Any FAIL is a difference between disk and expectation; read the report file.
2. Read <the active job file>: the STATUS block, then the last ~15 log lines.
3. Read the `live` section of the manifest (state of external platforms and the date each was last verified) and re-verify live before relying on it.
4. Read <the rules file(s) that govern the work>.
5. Read the assistant's own memory index if the user keeps one: <path>.

## 3) Where everything is
- <deliverable type>: `<folder>/`. Naming: `<stem>_vN.<ext>`, one current file, older versions in `_archive/`. The word FINAL is never used.
- Memory system files: `MDs/System_Current_MD/`; archive `MDs/System_Previous_MDs/` (a dated copy before every change). Update proposals go to `Jobs/_proposals/`, then `_merged/` after merging.
- Tools and agents: <scripts, agents, scheduled tasks and what each is for>.

## 4) Hard rules (summary; details live in the rules file)
- <rule 1>
- <rule 2>

## 5) Current state (changing; do not trust a fixed text here)
The single reference is the manifest `live` section plus the STATUS block of the active job. Verify live before relying on it: <which tool or page to check for each platform>.

## 6) Pending / next (in the order the owner decided)
1. <item>
2. <item>

## 6b) Keeping these files current (optional end-of-work check)
Update order after any work: the work log first, the manifest next, this file last (the check compares file times). If the project uses the plugin's end-of-work check (`MDs/freshness.json`), the Stop hook blocks ending a turn once when this session wrote work files and these state files are older. <Say here whether the project uses it, and any project-specific reminder.>

## 7) Common mistakes learned
- <mistake and the fix>
- `--init` on the inventory accepts whatever is on disk as correct. Run it only after a manual check.

## 8) Old rules that changed (do not follow them if you find them)
- <stale source: agent definition, scheduled task, old note> says "<old rule>". What governs now: <current rule>, decided by <who> on <date>. Still forbidden: <what remains forbidden>.

## 9) Permissions and limits (clarification)
<Where a restriction applies only to one plan or job and where a standing permission is delegated, and in which file each is written. State the conflict explicitly if two files disagree.>
