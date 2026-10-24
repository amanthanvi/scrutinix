#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  baseUrlParts,
  canonicalPath,
  checkHealth,
  checkoutListeners,
  ensureDirs,
  evidenceDir,
  foreignNextStopHint,
  foreignRunLive,
  formatForeignNext,
  launchableBaseUrl,
  logTail,
  nodePathExport,
  ownedSession,
  parseCliBaseUrl,
  readState,
  recordNextEnvWritten,
  redactSecrets,
  rememberRun,
  repoRoot,
  runCommand,
  sessions,
  shellQuote,
  snapshotNextEnv,
  startTmuxSession,
  stateDir,
  stopRecordedProcess,
  stopRecordedSession,
  tcpOpen,
  tmuxAvailable,
  tmuxSessionIdentity,
} from "./runtime.mjs";

// The published, test-only share key, exactly as scripts/run-e2e.mjs passes
// it. lib/config/env.ts accepts it only while SCRUTINIX_TEST_FIXTURES=1 and
// ignores every other key in fixture mode, so this run can sign fixture
// verdicts and nothing else. Never put a real key here.
const E2E_SHARE_SIGNING_SECRET =
  "e2e-only-share-signing-key-not-a-real-secret-0001";

const help = `verify-scrutinix launch

Start the local Next.js dev server for verification when the port is free.
The server runs with SCRUTINIX_TEST_FIXTURES=1 so scans use offline fixtures,
and with the published e2e share key (the same one npm run test:e2e uses), so
Share produces signed links that open as verified results.

Usage:
  node .agents/skills/verify-scrutinix/scripts/launch.mjs [--base-url URL]
  npm run verify:launch
  npm run verify:launch -- --base-url http://127.0.0.1:3417

The base URL must be http://127.0.0.1:<port> (default port 3000). doctor,
smoke, and cleanup reuse the URL recorded for this checkout.

A READY instance this skill already owns for this checkout is reused.
Cleanup will not stop a server this skill did not start, including one
recorded for a different checkout.
Set VERIFY_SKIP_BROWSER_INSTALL=1 to skip Playwright Chromium install.
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(help);
  process.exit(0);
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await delay(1_000);
  }
  return "";
}

const parsedBaseUrl = parseCliBaseUrl();
if (!parsedBaseUrl.ok) {
  process.stderr.write(`launch: ${parsedBaseUrl.message}\n`);
  process.exit(2);
}
const baseUrl = parsedBaseUrl.baseUrl;
if (!launchableBaseUrl(baseUrl)) {
  process.stderr.write(
    `launch: refusing ${baseUrl}. Use http://127.0.0.1:<port> with a port from 1024 to 65535.\n`,
  );
  process.exit(2);
}
const { port } = baseUrlParts(baseUrl);

ensureDirs();

function remember(started, extra = {}) {
  rememberRun(started, { ...extra, baseUrl });
}

function existsStamp(relativePath) {
  const file = path.join(repoRoot, relativePath);
  if (!existsSync(file)) return "missing";
  return readFileSync(file, "utf8");
}

// next dev rewrites next-env.d.ts for its dev distDir. Wait for the file to
// settle, then record what it wrote so cleanup can restore the snapshot.
async function captureSettledNextEnv() {
  let previous = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const stamp = existsStamp("next-env.d.ts");
    if (attempt > 0 && stamp === previous) break;
    previous = stamp;
    await delay(500);
  }
  recordNextEnvWritten();
}

function refuseForeignNext() {
  const summary = formatForeignNext(port);
  if (!summary) return false;
  process.stderr.write(`launch: ${summary}\n`);
  process.stderr.write(`launch: ${foreignNextStopHint(port)}\n`);
  return true;
}

function failWithLog(reason, logPath) {
  process.stderr.write(`launch: ${reason}. Log: ${logPath}\n`);
  process.stderr.write(
    "launch: last lines of the log, with secrets redacted:\n",
  );
  process.stderr.write(`${logTail(logPath)}\n`);
}

const require = createRequire(import.meta.url);
const initial = await checkHealth(baseUrl);
const listening = await tcpOpen(port);
const owned = ownedSession();
const state = readState();

if (initial.ok && owned) {
  process.stdout.write(`${initial.lines.join("\n")}\n`);
  process.stdout.write(
    `launch: REUSED existing READY instance for ${canonicalPath(repoRoot)}\n`,
  );
  remember([]);
  process.exit(0);
}

if (foreignRunLive(state, port)) {
  process.stdout.write(`${initial.lines.join("\n")}\n`);
  process.stderr.write(
    `launch: run.json in ${stateDir} belongs to ${state?.repoRoot || "another checkout"}, and that run is still live. Refusing to reuse or stop it from ${canonicalPath(repoRoot)}. Set VERIFY_STATE_DIR to use a separate state directory.\n`,
  );
  refuseForeignNext();
  process.exit(2);
}

if (
  (listening ||
    initial.code === "foreign-server" ||
    initial.code === "foreign-next") &&
  !owned
) {
  process.stdout.write(`${initial.lines.join("\n")}\n`);
  if (!refuseForeignNext()) {
    process.stderr.write(
      `launch: port ${port} is already taken by a process this skill did not start. Refusing to start a second server.\n`,
    );
  }
  process.exit(2);
}

if (!tmuxAvailable()) {
  process.stderr.write(
    "launch: tmux is required so cleanup can stop the session this skill started\n",
  );
  process.exit(1);
}

if (!owned && tmuxSessionIdentity(sessions.next)) {
  process.stderr.write(
    `launch: a tmux session named ${sessions.next} exists, and run.json does not record it as this launch. Refusing to reuse or stop it.\n`,
  );
  process.exit(2);
}

if (!existsSync(path.join(repoRoot, "node_modules"))) {
  process.stdout.write("launch: installing dependencies\n");
  const install = runCommand("npm", ["ci"], { timeoutMs: 300_000 });
  if (install.stdout) process.stdout.write(redactSecrets(install.stdout));
  if (install.stderr) process.stderr.write(redactSecrets(install.stderr));
  if (install.status !== 0) process.exit(install.status ?? 1);
}

if (process.env.VERIFY_SKIP_BROWSER_INSTALL !== "1") {
  process.stdout.write("launch: ensuring Playwright Chromium is installed\n");
  const cli = require.resolve("@playwright/test/cli");
  const browsers = runCommand(process.execPath, [cli, "install", "chromium"], {
    timeoutMs: 300_000,
  });
  if (browsers.stdout) process.stdout.write(redactSecrets(browsers.stdout));
  if (browsers.status !== 0) {
    process.stderr.write(redactSecrets(browsers.stderr || ""));
    process.stderr.write(
      "launch: browser install failed. Run: npx playwright install --with-deps chromium\n",
    );
    process.exit(browsers.status ?? 1);
  }
}

const declaration = snapshotNextEnv();
if (declaration.warning) {
  process.stderr.write(`${declaration.warning}\n`);
}
process.stdout.write(
  declaration.kept
    ? "launch: kept the existing next-env.d.ts snapshot\n"
    : "launch: snapshotted next-env.d.ts\n",
);

if (owned) {
  process.stdout.write("launch: restarting the Next session this skill owns\n");
  const results = [
    stopRecordedSession(owned),
    ...(Array.isArray(state?.listeners) ? state.listeners : []).map(
      (listener) => stopRecordedProcess(listener),
    ),
  ];
  for (const result of results) {
    process.stdout.write(`launch: ${result.message}\n`);
  }
  await waitFor(async () => !(await tcpOpen(port)), 15_000);
}

const logPath = path.join(stateDir, `${sessions.next}.log`);
process.stdout.write("launch: starting Next.js dev session\n");
const nextScript = `#!/usr/bin/env bash
set -euo pipefail
${nodePathExport()}
cd ${shellQuote(repoRoot)}
export SCRUTINIX_TEST_FIXTURES=1
export SHARE_SIGNING_SECRET=${shellQuote(E2E_SHARE_SIGNING_SECRET)}
export SHARE_SIGNING_SECRET_PREVIOUS=
export NEXT_TELEMETRY_DISABLED=1
export UPSTASH_REDIS_REST_URL=
export UPSTASH_REDIS_REST_TOKEN=
export KV_REST_API_URL=
export KV_REST_API_TOKEN=
exec npm run dev -- --hostname 127.0.0.1 --port ${port}
`;
// startTmuxSession records the session identity in run.json as soon as tmux
// creates it, so a failed boot is still cleaned up.
const { session } = startTmuxSession(sessions.next, nextScript);
remember([session]);

const sessionAlive = () => {
  const current = tmuxSessionIdentity(sessions.next);
  return current !== null && current.id === session.id;
};

const up = await waitFor(() => {
  if (!sessionAlive()) return "dead";
  return tcpOpen(port).then((open) => (open ? "ready" : ""));
}, 180_000);

if (up !== "ready") {
  failWithLog(
    `Next session ${up === "dead" ? "exited" : "timed out"}`,
    logPath,
  );
  await captureSettledNextEnv();
  process.exit(1);
}

const deadline = Date.now() + 180_000;
let report = await checkHealth(baseUrl);
while (
  !report.ok &&
  report.code !== "foreign-server" &&
  report.code !== "foreign-next" &&
  Date.now() < deadline
) {
  if (!sessionAlive()) {
    failWithLog("Next session exited", logPath);
    await captureSettledNextEnv();
    process.exit(1);
  }
  await delay(1_000);
  report = await checkHealth(baseUrl);
}

// Record the exact listener processes serving this checkout, so cleanup can
// stop them after re-reading the same identity.
remember([session], { listeners: checkoutListeners(port) });
await captureSettledNextEnv();
process.stdout.write(`${report.lines.join("\n")}\n`);
if (!report.ok) {
  failWithLog(`instance is NOT_READY (${report.code})`, logPath);
  process.exit(2);
}
process.stdout.write(`launch: READY ${baseUrl}\n`);
process.stdout.write(`launch: evidence directory ${evidenceDir}\n`);
