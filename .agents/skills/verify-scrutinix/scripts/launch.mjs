#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  agentEnvUnset,
  baseUrlParts,
  canonicalPath,
  checkHealth,
  foreignNextStopHint,
  parseCliBaseUrl,
  ensureDirs,
  evidenceDir,
  killTmuxSession,
  cmdline,
  listenerPids,
  nodePathExport,
  formatForeignNext,
  ownsInstance,
  readState,
  recordNextEnvWritten,
  rememberRun,
  repoRoot,
  runCommand,
  sameCheckout,
  sessionExists,
  sessions,
  shellQuote,
  snapshotNextEnv,
  startTmuxSession,
  stateDir,
  stripAgentRules,
  tcpOpen,
  tmuxAvailable,
} from "./runtime.mjs";

const help = `verify-scrutinix launch

Start the local Next.js dev server for verification when port 3000 is free.
The server runs with SCRUTINIX_TEST_FIXTURES=1 so scans use offline fixtures.

Usage:
  node .agents/skills/verify-scrutinix/scripts/launch.mjs [--base-url URL]
  npm run verify:launch

A READY instance this skill already owns for this checkout is reused.
Cleanup will not stop a server this skill did not start, including one
recorded for a different checkout.
Set VERIFY_SKIP_BROWSER_INSTALL=1 to skip Playwright Chromium install.
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(help);
  process.exit(0);
}

function readLog(file) {
  try {
    return existsSync(file) ? readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
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
const { port, loopback } = baseUrlParts(baseUrl);
if (!loopback || port !== 3000 || new URL(baseUrl).hostname !== "127.0.0.1") {
  process.stderr.write(
    `launch: refusing ${baseUrl}. This skill owns only http://127.0.0.1:3000\n`,
  );
  process.exit(2);
}

ensureDirs();

function remember(started, extra = {}) {
  rememberRun(started, { ...extra, baseUrl });
}

async function captureSettledDevEdits() {
  let previous = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    stripAgentRules();
    const stamp = `${existsStamp("next-env.d.ts")}:${existsStamp("AGENTS.md")}`;
    if (attempt > 0 && stamp === previous) {
      recordNextEnvWritten();
      return;
    }
    previous = stamp;
    await delay(500);
  }
  stripAgentRules();
  recordNextEnvWritten();
}

function refuseForeignNext(port) {
  const summary = formatForeignNext(port);
  if (!summary) return false;
  process.stderr.write(`launch: ${summary}\n`);
  process.stderr.write(`launch: ${foreignNextStopHint(port)}\n`);
  return true;
}

function existsStamp(relativePath) {
  const file = path.join(repoRoot, relativePath);
  if (!existsSync(file)) return "missing";
  return readFileSync(file, "utf8");
}

const require = createRequire(import.meta.url);
const initial = await checkHealth(baseUrl);
const listening = await tcpOpen(port);
const owned = ownsInstance();
const state = readState();
const foreignListeners = listenerPids(port).some((pid) =>
  cmdline(pid).includes(String(state?.repoRoot ?? "\0")),
);
const foreignLive =
  Boolean(state) &&
  !sameCheckout(state) &&
  (sessionExists(sessions.next) || foreignListeners);

if (initial.ok && owned) {
  process.stdout.write(`${initial.lines.join("\n")}\n`);
  process.stdout.write(
    `launch: REUSED existing READY instance for ${canonicalPath(repoRoot)}\n`,
  );
  remember([]);
  process.exit(0);
}

if (foreignLive) {
  process.stdout.write(`${initial.lines.join("\n")}\n`);
  process.stderr.write(
    `launch: port 3000 or session ${sessions.next} belongs to ${state?.repoRoot || "another checkout"}. Refusing to reuse or stop it from ${canonicalPath(repoRoot)}.\n`,
  );
  refuseForeignNext(port);
  process.exit(2);
}

if (
  (listening ||
    initial.code === "foreign-server" ||
    initial.code === "foreign-next") &&
  !owned
) {
  process.stdout.write(`${initial.lines.join("\n")}\n`);
  if (!refuseForeignNext(port)) {
    process.stderr.write(
      "launch: port 3000 is already taken by a process this skill did not start. Refusing to start a second server.\n",
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

if (!existsSync(path.join(repoRoot, "node_modules"))) {
  process.stdout.write("launch: installing dependencies\n");
  const install = runCommand("npm", ["ci"], { timeoutMs: 300_000 });
  if (install.stdout) process.stdout.write(install.stdout);
  if (install.stderr) process.stderr.write(install.stderr);
  if (install.status !== 0) process.exit(install.status ?? 1);
}

if (process.env.VERIFY_SKIP_BROWSER_INSTALL !== "1") {
  process.stdout.write("launch: ensuring Playwright Chromium is installed\n");
  const cli = require.resolve("@playwright/test/cli");
  const browsers = runCommand(process.execPath, [cli, "install", "chromium"], {
    timeoutMs: 300_000,
  });
  if (browsers.stdout) process.stdout.write(browsers.stdout);
  if (browsers.status !== 0) {
    process.stderr.write(browsers.stderr || "");
    process.stderr.write(
      "launch: browser install failed. Run: npx playwright install --with-deps chromium\n",
    );
    process.exit(browsers.status ?? 1);
  }
}

const declaration = snapshotNextEnv();
process.stdout.write(
  declaration.kept
    ? "launch: kept the existing next-env.d.ts snapshot\n"
    : "launch: snapshotted next-env.d.ts\n",
);

if (owned && sessionExists(sessions.next)) {
  process.stdout.write("launch: restarting the Next session this skill owns\n");
  killTmuxSession(sessions.next);
  await delay(500);
}

const started = [];
const logPath = path.join(stateDir, `${sessions.next}.log`);
process.stdout.write("launch: starting Next.js dev session\n");
const nextScript = `#!/usr/bin/env bash
set -euo pipefail
${nodePathExport()}
cd ${shellQuote(repoRoot)}
${agentEnvUnset()}
export SCRUTINIX_TEST_FIXTURES=1
export NEXT_TELEMETRY_DISABLED=1
export UPSTASH_REDIS_REST_URL=
export UPSTASH_REDIS_REST_TOKEN=
export KV_REST_API_URL=
export KV_REST_API_TOKEN=
exec npm run dev -- --hostname 127.0.0.1 --port 3000
`;
startTmuxSession(sessions.next, nextScript);
started.push(sessions.next);
remember(started);

const up = await waitFor(() => {
  if (!sessionExists(sessions.next)) return "dead";
  return tcpOpen(port).then((open) => (open ? "ready" : ""));
}, 180_000);

if (up !== "ready") {
  process.stderr.write(
    `launch: Next session ${up === "dead" ? "exited" : "timed out"}. Log: ${logPath}\n`,
  );
  process.stderr.write(readLog(logPath).slice(-4000));
  await captureSettledDevEdits();
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
  if (!sessionExists(sessions.next)) {
    process.stderr.write(`launch: Next session exited. Log: ${logPath}\n`);
    process.stderr.write(readLog(logPath).slice(-4000));
    await captureSettledDevEdits();
    process.exit(1);
  }
  await delay(1_000);
  report = await checkHealth(baseUrl);
}

remember(started, { pids: listenerPids(port) });
await captureSettledDevEdits();
process.stdout.write(`${report.lines.join("\n")}\n`);
if (!report.ok) {
  process.stderr.write(
    `launch: instance is NOT_READY (${report.code}). Log: ${logPath}\n`,
  );
  process.stderr.write(readLog(logPath).slice(-4000));
  process.exit(2);
}
process.stdout.write(`launch: READY ${baseUrl}\n`);
process.stdout.write(`launch: evidence directory ${evidenceDir}\n`);
