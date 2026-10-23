# Safe rewrite of a large memory file

Dropbox's file tools can create a new text file or move a file, but cannot edit one. Changing a big memory file (for example a 80 KB decision log) therefore means re-emitting its whole text, and one wrong character anywhere (an Arabic diacritic, a comma type, a doubled word) is easy to miss. We hit this in practice: a 51 KB file typed back from context came out 12 bytes longer than the original, and a 82 KB candidate had one extra diacritic.

What works, in order:

1. Take a freshness snapshot of `MDs/System_Current_MD` (names, sizes, modified times) before you start. If a file changed meanwhile, stop.
2. Build the new file locally by script from the exact original plus your edits (never by hand). The text returned by the Dropbox `fetch` tool is exact; large results are saved to a file you can read with `jq -r .text`, which adds trailing newlines you must trim before comparing.
3. Check the local original first: `node scripts/dbxhash.mjs original.md <content_hash>` must print MATCH. Dropbox's `download_link` tool returns each file's `content_hash` (do not open the link; it is single use).
4. Upload the new file under a temporary name OUTSIDE `System_Current_MD` (for example into `System_Previous_MDs/<month>/`, name ending `_CANDIDATE`).
5. Ask Dropbox for the uploaded file's `content_hash` (the `download_link` tool returns it; do not open the link) and compare with `node scripts/dbxhash.mjs new.md`. Size and hash must both match. On a mismatch, fetch the uploaded text, diff it against the local file to find the exact characters, fix, and upload again under a new name. Never move a file that did not match.
6. Only then swap: move the live file into the archive (`<name>_YYYY-MM-DD`), immediately move the verified candidate into place, and list the folder to confirm.
7. Remove leftover candidates (deleting needs the owner's approval).

`dbxhash.mjs` is read-only and has no network access. The expected hash may include spaces, a newline or a `sha256:` prefix; an empty or malformed one is an error (exit 2), never a pass. Directories and other non-regular files are refused.
