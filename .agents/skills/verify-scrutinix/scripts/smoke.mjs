#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { closeSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  baseUrlFor,
  evidenceDir,
  exitSummary,
  logPath,
  openPrivateLog,
  parseCliArgs,
  redactSecrets,
  repoRoot,
  skillDir,
  summarizePlaywrightReport,
} from "./runtime.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

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
and the paths of the log, the HTML report, and the traces.
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(help);
  process.exit(0);
}

const args = parseCliArgs(undefined, { flags: ["--drive"], rest: true });
if (!args.ok) {
  process.stderr.write(`smoke: ${args.message}\n`);
  process.exit(2);
}
const drive = args.flags.has("--drive");
const suite = drive ? "drive" : "smoke";
const spec = path.join(scriptDir, `${suite}.spec.ts`);
const config = path.join(skillDir, "playwright.config.mjs");
const require = createRequire(import.meta.url);
// VERIFY_PLAYWRIGHT_CLI is for the skill's own tests (runtime.check.mjs),
// which stand in a fake Playwright that prints a canary.
const cli =
  process.env.VERIFY_PLAYWRIGHT_CLI || require.resolve("@playwright/test/cli");

// doctor prints only selected fields; its lines are redacted again anyway.
const doctor = spawnSync(
  process.execPath,
  [path.join(scriptDir, "doctor.mjs"), "--port", String(args.port)],
  { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
if (doctor.stdout) process.stdout.write(redactSecrets(doctor.stdout));
if (doctor.stderr) process.stderr.write(redactSecrets(doctor.stderr));
if (doctor.status !== 0) {
  process.stderr.write("smoke: doctor is not READY, browser not started\n");
  process.exit(doctor.status ?? 2);
}

const log = logPath(`${suite}.log`);
const reportFile = logPath(`${suite}-report.json`);
rmSync(reportFile, { force: true });
const env = {
  ...process.env,
  E2E_BASE_URL: baseUrlFor(args.port),
  VERIFY_EVIDENCE_DIR: evidenceDir,
  VERIFY_SUITE: suite,
  VERIFY_REPORT_FILE: reportFile,
};
// Everything Playwright writes (report, traces, screenshots) is private to
// this user.
process.umask(0o077);
const fd = openPrivateLog(log);
let child;
try {
  child = spawnSync(
    process.execPath,
    [cli, "test", "--config", config, spec, ...args.rest],
    { cwd: repoRoot, env, stdio: ["ignore", fd, fd] },
  );
} finally {
  closeSync(fd);
}

const summary = summarizePlaywrightReport(reportFile);
const out = child.status === 0 ? process.stdout : process.stderr;
if (summary) {
  out.write(
    `${suite}: Playwright ${exitSummary(child)}: ${summary.passed} passed, ${summary.failed} failed, ${summary.flaky} flaky, ${summary.skipped} skipped\n`,
  );
  for (const title of summary.failedTitles) {
    out.write(`${suite}: failed: ${title}\n`);
  }
  if (summary.errors) {
    out.write(
      `${suite}: ${summary.errors} error${summary.errors === 1 ? "" : "s"} outside any test (see the log)\n`,
    );
  }
} else {
  out.write(`${suite}: Playwright ${exitSummary(child)} and wrote no report\n`);
}
out.write(`${suite}: log ${log} (raw, mode 0600; do not paste it)\n`);
out.write(
  `${suite}: report ${path.join(evidenceDir, "playwright-report", suite)}, traces ${path.join(evidenceDir, "test-results", suite)}\n`,
);
process.exit(child.status ?? 1);
