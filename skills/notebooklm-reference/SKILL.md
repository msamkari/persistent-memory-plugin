---
name: notebooklm-reference
description: OPTIONAL guide for using Google NotebookLM with large, non-sensitive reference documents (books, papers, manuals). There is NO official Claude connector for a personal NotebookLM account, so this skill starts with a safe manual path and only then explains optional third-party tools. Use when the user says "NotebookLM", "connect NotebookLM", "ask my notebook", "ربط NotebookLM". NEVER for the Persistent Memory files themselves.
---
# NotebookLM for large reference documents (optional guide)

## Say this first, in the user's language (before anything else)
1. **There is no official connector between Claude and a personal NotebookLM account.** Do not describe any option below as "connecting" Claude to NotebookLM unless the user has chosen the advanced path and approved each step.
2. **Never upload the Persistent Memory files** (`System_Current_MD`, archives, handover, logs), personal or family data, participant or client data, credentials, or unpublished drafts. Anything put into NotebookLM is uploaded to Google. If you or an earlier answer suggested uploading memory files, say so plainly and correct it.
3. You never type, read or store a password, cookie or token. The user signs in themselves.

## Default path: manual and safe (recommended)
1. Ask which documents the user wants. If any is sensitive, stop and recommend not using NotebookLM for it.
2. The user opens notebooklm.google.com, creates a notebook and adds only the non-sensitive documents (upload or Google Drive).
3. The user asks their questions there and pastes the answer or the cited passage into the chat. Claude then works from that text.
4. Be honest about the benefit: the bulk of a large document stays out of the context window, which saves tokens. It is not "zero tokens" (each pasted answer still enters the conversation) and not "zero hallucination" (answers cite sources, which reduces errors but does not remove them). Check any quote that matters.

## Advanced path: a third-party tool (only if the user insists, step by step)
These tools are unofficial and not affiliated with Google. Tell the user, before anything is installed:
- They use undocumented Google interfaces, can break without notice, and may conflict with Google's terms of service for the account that uses them.
- They keep a login session (cookies or a token) on the user's own disk, so the account that signs in is exposed if that folder leaks. Recommend a separate Google account used only for this, never the account that holds the user's thesis, mail or memory files.
- Many of them drive a real browser on the user's behalf.

Steps (each needs an explicit yes in chat):
1. **Find the tool; do not guess a package name.** Search the MCP registry or official docs, then show the user: name, maintainer, source link, what it requests (browser sign-in, local files) and that it is unofficial. Read its README and install instructions first and report anything that runs code at install time. *(approval required before installing)*
2. After approval, install it with its documented command only (typically `claude mcp add ...`, `pipx`, `uv tool` or `pip`). Report exactly what was installed and where.
3. The user runs the tool's login step themselves in their own terminal or browser. Do not automate the sign-in.
4. Test with one non-sensitive question and show the cited source passage.
5. To remove it later: `claude mcp remove <name>` (offer this, do not run it unasked), and tell the user to delete the tool's saved session folder and to revoke the session in their Google account.

If any step fails twice, stop and report what happened instead of trying variants.
