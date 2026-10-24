#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evidenceDir,
  preferredBaseUrl,
  repoRoot,
  skillDir,
} from "./runtime.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const help = `verify-scrutinix smoke

Run doctor, then a Playwright spec against the server verify:launch started.
The browser does not open when doctor exits 2.

Usage:
  node .agents/skills/verify-scrutinix/scripts/smoke.mjs
  node .agents/skills/verify-scrutinix/scripts/smoke.mjs --drive
  node .agents/skills/verify-scrutinix/scripts/smoke.mjs --drive -g "batch scan"
  npm run verify:smoke
  npm run verify:drive

--drive runs scripts/drive.spec.ts (the feature map).
Without --drive, scripts/smoke.spec.ts runs one safe scan.
Extra arguments are passed to Playwright.
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(help);
  process.exit(0);
}

const drive = process.argv.includes("--drive");
const extra = process.argv.slice(2).filter((arg) => arg !== "--drive");
const spec = path.join(scriptDir, drive ? "drive.spec.ts" : "smoke.spec.ts");
const config = path.join(skillDir, "playwright.config.mjs");
const require = createRequire(import.meta.url);
const cli = require.resolve("@playwright/test/cli");

const baseUrl = preferredBaseUrl();
const doctor = spawnSync(
  process.execPath,
  [path.join(scriptDir, "doctor.mjs"), "--base-url", baseUrl],
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
