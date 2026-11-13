# Privacy, support and terms

**Short version:** this plugin sends nothing anywhere. It has no network code, no accounts and no telemetry.

## What it reads and writes
- Your memory files and project state files (file names, dates and, for the memory skills, the text you keep in them). They stay on your computer, in the folders you choose.
- Hooks read the text of the shell command or the session they are shown, only to decide whether to warn, block or ask; they do not store it. A hook writes only (a) the one marker file per project in the plugin's own data folder (`CLAUDE_PLUGIN_DATA`: a state word and a date, no path and no project name) and (b) an activity line when you configured a memory folder.
- Scripts read named environment variables only (`PMS_*`, `CLAUDE_PLUGIN_*`, `CLAUDE_PROJECT_DIR` and Windows system folder names), never the whole environment.

## What it sends
Nothing. The plugin does not contact any server. What Claude itself does with text you let it read is governed by your Claude plan and Anthropic's own terms and privacy policy.

## Retention
The plugin keeps no data of its own beyond the files above, which you can read, edit and delete at any time. Removing the plugin's data folder removes the markers.

## Audience
Not directed at children; the plugin is a developer and power-user tool.

## Support
Questions and bug reports: https://github.com/msamkari/persistent-memory-plugin/issues

## Terms of use
The plugin is provided under the Apache License 2.0 (see `LICENSE`), without warranty. You are responsible for the content of the memory files you write and for keeping secrets out of them.
