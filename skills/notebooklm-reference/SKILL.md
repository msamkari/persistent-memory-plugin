---
name: notebooklm-reference
description: OPTIONAL. Query large reference documents (books, papers, manuals) through Google NotebookLM over MCP instead of loading them into the context window. Use when the user says "use NotebookLM", "connect NotebookLM", "ask my notebook", "ربط NotebookLM". NEVER for the Persistent Memory files themselves.
disable-model-invocation: true
---
# NotebookLM for large reference documents (optional)

## Privacy warning: say this first, in the user's language
- Anything put into NotebookLM is uploaded to Google. **Never upload Persistent Memory files, personal or family data, credentials, or client-confidential material.** The memory system is designed to keep data in the user's own storage; this skill is for public or non-sensitive reference documents only.
- Sign-in uses the user's own Google account. The user signs in; you never type, read or store a password, cookie or token.
- Be honest about benefits: the bulk of a large document stays out of the context window, which saves tokens. It is not "zero tokens" (each answer still comes back into the conversation) and not "zero hallucination" (answers are grounded in the uploaded sources with citations, which reduces errors but does not remove them). Check cited passages for anything that matters.

## Steps (each marked step needs the user's explicit yes in chat)
1. Ask what the documents are. If they include anything sensitive, stop and recommend not using NotebookLM for them.
2. **Find the tool; do not guess a package name.** Search the MCP registry / official docs, then show the user: name, maintainer, source link, what it requests (browser sign-in, local files), and that it is an unofficial third-party tool unless the maintainer is Google. *(approval required before installing)*
3. After approval, install it with the documented command (typically `claude mcp add ...`). Run only the documented command. Report exactly what was installed and where.
4. Tell the user to run the tool's own login step themselves in their terminal/browser. Do not automate the sign-in or handle credentials.
5. Test with one non-sensitive question and show the cited source passage.
6. To remove it later: `claude mcp remove <name>` (offer this, do not run it unasked).

If any step fails twice, stop and report what happened instead of trying variants.
