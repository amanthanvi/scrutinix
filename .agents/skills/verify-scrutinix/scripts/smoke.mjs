#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  baseUrlFor,
  evidenceDir,
  parseCliArgs,
  repoRoot,
  skillDir,
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
const extra = args.rest;
const spec = path.join(scriptDir, drive ? "drive.spec.ts" : "smoke.spec.ts");
const config = path.join(skillDir, "playwright.config.mjs");
const require = createRequire(import.meta.url);
const cli = require.resolve("@playwright/test/cli");

const baseUrl = baseUrlFor(args.port);
const doctor = spawnSync(
  process.execPath,
  [path.join(scriptDir, "doctor.mjs"), "--port", String(args.port)],
  { cwd: repoRoot, stdio: "inherit" },
);
if (doctor.status !== 0) {
  process.stderr.write("smoke: doctor is not READY, browser not started\n");
  process.exit(doctor.status ?? 2);
}

const env = {
  ...process.env,
  E2E_BASE_URL: baseUrl,
  VERIFY_EVIDENCE_DIR: evidenceDir,
  VERIFY_SUITE: drive ? "drive" : "smoke",
};
const child = spawnSync(
  process.execPath,
  [cli, "test", "--config", config, spec, ...extra],
  { cwd: repoRoot, stdio: "inherit", env },
);
process.exit(child.status ?? 1);
