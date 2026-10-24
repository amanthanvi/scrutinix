#!/usr/bin/env node
import { createRequire } from "node:module";

import { runSuite } from "./suite.mjs";

const help = `verify-scrutinix smoke

Run doctor, then a Playwright spec against the server verify:launch started.
The browser does not open when doctor exits 2.

Usage:
  node .agents/skills/verify-scrutinix/scripts/smoke.mjs [--port <n>]
  node .agents/skills/verify-scrutinix/scripts/smoke.mjs --drive
  node .agents/skills/verify-scrutinix/scripts/smoke.mjs --drive -g "batch scan"
  npm run verify:smoke
  npm run verify:drive
  npm run verify:drive -- --port 3417 -g "batch scan"

--drive runs scripts/drive.spec.ts (the feature map).
Without --drive, scripts/smoke.spec.ts runs one safe scan.
--port is an integer from 1024 to 65535 (default: the port this checkout
last launched on, else 3000); --base-url exits 2. Other arguments are passed
to Playwright.

Playwright's own output goes to smoke.log or drive.log in the state
directory (mode 0600), not to this terminal. smoke prints the exit status,
the passed, failed, flaky, and skipped counts, each failing test's title,
and the paths of the log, the HTML report, and the traces. A run with no
Playwright report, or a report in which no test ran, exits non-zero.
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(help);
  process.exit(0);
}

// Always the real Playwright CLI. No variable or argument swaps it.
const require = createRequire(import.meta.url);
process.exit(
  runSuite(process.argv.slice(2), require.resolve("@playwright/test/cli")),
);
