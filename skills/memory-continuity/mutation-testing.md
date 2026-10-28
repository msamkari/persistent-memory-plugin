# Mutation test for a check script (G3)

A check that has only ever passed has not been shown to check anything. Success right after `--init` is expected by construction (init copies the disk into the manifest) and proves nothing. Before you trust the inventory script, or any lint or doctor you write, make it fail on purpose.

Procedure (on a copy of the project, or with a restore step; never mutate the only copy):
1. Run the check. It must pass. Record the count ("PASS n of n").
2. Apply ONE artificial fault. Run the check. It must FAIL, and the failing line must name that fault. Undo the fault. Run again: it must pass with the same count.
3. Repeat for each fault below. A fault the script does not catch is a bug in the script (or a check missing from CONFIG), not a success.

Faults to try with `continuity-inventory.mjs`:
| Fault | Expected failing line |
|---|---|
| Delete a current deliverable | `current file ... exists` |
| Append one byte to a deliverable | `SHA-256 matches the manifest` and `size` |
| Copy it as `<stem>_v9.<ext>` into the same folder | `only one versioned file` |
| Add a file whose name contains FINAL | `no "FINAL" name` |
| Delete a companion file | `companion ...` |
| Remove the current file name from the job file | `contains <name>` |
| Set one platform's `live.verified.<p>.at` to 10 days ago | `live state (<p>) verified within` |
| Remove the HANDOVER line from CLAUDE.md | `entry point CLAUDE.md contains HANDOVER` |

The plugin's own test `tests/continuity.test.mjs` runs this procedure automatically against the template, in a temporary folder. Keep the same habit for your project's copy: record in the job log the date you ran the mutation test and how many faults were caught out of how many tried (for example "8 of 8").

Do not run `--init` to make a failing check pass. First decide whether the disk or the manifest is right.
