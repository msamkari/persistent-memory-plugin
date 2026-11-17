#!/usr/bin/env node
// Copies ONE file from outside the project into the project's archive folder (see archive.mjs, v1.9.0).
// Deliberately a separate entry that no skill pre-approves: Claude Code asks the user before it runs.
//   node archive-external.mjs <absolute-path> [--root DIR] [--to DIR] [--date YYYY-MM-DD] [--write]
import { runExternalCli } from "./archive.mjs";
process.exit(runExternalCli(process.argv.slice(2)));
