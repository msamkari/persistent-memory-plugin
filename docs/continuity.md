# Continuity: conventions around the memory system

Additive notes that go with the skill `memory-continuity` (HANDOVER file, inventory script, cold-start test). Nothing here changes how the memory files are read, written or archived, and none of it is wired into the hooks. Items are numbered G1 to G12 after the lessons list they come from.

| Item | Where |
|---|---|
| G1 HANDOVER.md and the CLAUDE.md pointer | `skills/memory-continuity/templates/HANDOVER.md`, `CLAUDE.pointer.md` |
| G2 inventory and manifest script | `skills/memory-continuity/templates/continuity-inventory.mjs` |
| G3 mutation test | `skills/memory-continuity/mutation-testing.md` |
| G4 cold-start test | `skills/memory-continuity/cold-start-test.md`, `templates/answer-key.md` |
| G5 proposal archive | below |
| G6 version names | below |
| G7 closing overtaken scheduled tasks | below |
| G8 "old rules that changed" | `HANDOVER.md` template section 8 and the skill |
| G9 agent tools and MCP | below |
| G10 advisor budget | README, "Long sessions: use the advisor" |
| G11 Windows hints | below |
| G12 project lessons vs system lessons | skill `memory-continuity`, "Where lessons go" |

## G5. Proposal archive: `_proposals` then `_merged`
A proposed memory change is written as a file in `Jobs/_proposals/` instead of editing `System_Current_MD` directly. Whoever merges it (the memory-keeper role, or you) follows these steps:
1. Merge the content into the memory files, archiving the replaced file first as usual.
2. Compute the proposal's hash: `node scripts/dbxhash.mjs Jobs/_proposals/<file>` (any stable hash such as SHA-256 works; use one kind consistently and say which in the INDEX header).
3. Move (do not copy, do not delete) the proposal to `Jobs/_merged/<file>`.
4. Add one line to `Jobs/_merged/INDEX.md`: `date | file | hash | merged into (file and entry number) | who approved`.
5. A file in `_merged/` is never edited again. If the hash of a file no longer matches its INDEX line, treat it as changed after merging and report it.
`_proposals/` then only holds what is still open, which makes "what is pending" a folder listing.

## G6. Version names: `vN`, never FINAL
A deliverable is named `<stem>_vN.<ext>` with N rising by one for every new version. The word FINAL (or "final2", "new", "latest") is never used: it stops being true the next day and a second "final" makes the folder ambiguous. Keep exactly one current file of each kind in the folder and move every older version to `_archive/` at once, in the same step that creates the new one. Companion files carry the same N (`<stem>_cover_v3.jpg`). The inventory script checks all of this (one versioned file, no FINAL).

## G7. Close overtaken scheduled tasks
A recurring task written weeks ago may read a status file and act on its "next" list with nobody watching, long after the plan changed. When a job is closed or replaced: put DONE (with the date) at the top of its STATUS block, remove the "next" list or mark it obsolete, and disable or delete the scheduled task in the scheduler. List the scheduled tasks in HANDOVER.md with their state (active, disabled), and add them to the "old rules that changed" section if their text contradicts a newer decision.

## G9. Agent tools do not inherit MCP tools
A subagent defined with a `tools:` list in its frontmatter gets exactly those tools. MCP tools from other connectors are not inherited, so an agent that needs one (an audio tool, another storage connector) must list it by its full name. Two consequences: add the tool explicitly in the agent definition, and remember that agents already running do not see the change, so start a new one. When a cold-start test fails with "file not found" for something that exists, check this first. Do not widen an agent's tools beyond read access just to make a test pass. The `memory-verifier` agent lists only read tools for Dropbox; for another connector, give it a local path to read instead or copy the definition and add that connector's read tools by hand.

## G11. Windows hints
- Console encoding: Python on a Windows console may print through cp1252 and crash on Arabic or symbols (`UnicodeEncodeError`). At the top of the script: `sys.stdout.reconfigure(encoding="utf-8")` (wrap it in `try`). Node scripts print UTF-8 already; if the console shows garbage, the font or code page is the cause, not the file.
- BOM: Windows PowerShell 5.1 `Set-Content -Encoding utf8` and some editors write a UTF-8 BOM. A BOM breaks `JSON.parse`, shell shebangs and exact-text comparison. Strip it when reading (the inventory script does) and write with `Out-File -Encoding utf8NoBOM` on PowerShell 7 or with a script that writes bytes.
- Locked file in Dropbox: a PDF open in a viewer is locked, so overwriting or moving it fails (or Dropbox makes a "conflicted copy"). Close the viewer first. If you cannot, write the new version under a new `vN` name and archive the old one later.
- Line endings: git may check text files out with CRLF on Windows. Compare hashes of the committed bytes (`git show <ref>:<path>`) when you need a byte-exact match.
