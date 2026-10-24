#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  acquireStateLock,
  baseUrlFor,
  canonicalPath,
  checkHealth,
  ensureDirs,
  evidenceDir,
  foreignNextStopHint,
  formatForeignNext,
  legacyPids,
  legacyState,
  loadState,
  logTail,
  parseCliArgs,
  recordNextEnvWritten,
  redactSecrets,
  releaseStateLock,
  repoRoot,
  runCommand,
  sameCheckout,
  snapshotNextEnv,
  startSupervisor,
  stateDir,
  stopRun,
  supervisorRequest,
  tcpOpen,
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
  node .agents/skills/verify-scrutinix/scripts/launch.mjs [--port <n>]
  npm run verify:launch
  npm run verify:launch -- --port 3417

The server is always http://127.0.0.1:<port>. --port is an integer from 1024
to 65535 (default: the port this checkout last launched on, else 3000). Any
other argument, including --base-url, exits 2 without repeating it. doctor,
smoke, and cleanup reuse the port recorded for this checkout.

launch starts a detached supervisor that runs next dev in its own process
group and answers on a private socket. A READY instance this checkout's
supervisor serves is reused. Cleanup asks that supervisor to stop its own
group, and never stops anything else.
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

const args = parseCliArgs();
if (!args.ok) {
  process.stderr.write(`launch: ${args.message}\n`);
  process.exit(2);
}
const { port } = args;
const baseUrl = baseUrlFor(port);

// Everything from reading run.json to the new run being recorded happens
// under the state lock, so a second launch or a cleanup cannot interleave.
let lock;
try {
  ensureDirs();
  lock = acquireStateLock("launch");
} catch (error) {
  process.stderr.write(
    `launch: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
}
process.on("exit", () => releaseStateLock(lock));
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ["SIGHUP", 129],
]) {
  process.on(signal, () => process.exit(code));
}

const loaded = loadState();
if (loaded.problem) {
  process.stderr.write(
    `launch: refusing to read ${stateDir}: ${loaded.problem}\n`,
  );
  process.exit(2);
}
const state = loaded.state;

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
  process.stderr.write(
    "launch: run npm run verify:cleanup before launching again.\n",
  );
}

const require = createRequire(import.meta.url);

if (legacyState(state)) {
  const pids = legacyPids(state);
  process.stderr.write(
    `launch: run.json in ${stateDir} was written by the tmux version of this skill. This version does not stop what that version started${pids.length ? ` (recorded pids ${pids.join(", ")})` : ""}. Check those yourself; launch replaces the record.\n`,
  );
} else if (state?.token) {
  const live = await supervisorRequest(state, "status");
  if (!sameCheckout(state)) {
    if (!live.gone) {
      process.stderr.write(
        `launch: run.json in ${stateDir} belongs to ${state.repoRoot || "another checkout"}, and its supervisor still answers. Refusing to reuse or stop it from ${canonicalPath(repoRoot)}. Set VERIFY_STATE_DIR to use a separate state directory.\n`,
      );
      process.exit(2);
    }
  } else if (live.proven) {
    const initial = await checkHealth(port);
    if (initial.ok) {
      process.stdout.write(`${initial.lines.join("\n")}\n`);
      process.stdout.write(
        `launch: REUSED existing READY instance for ${canonicalPath(repoRoot)}\n`,
      );
      process.exit(0);
    }
    process.stdout.write(
      "launch: restarting the run this checkout's supervisor owns\n",
    );
    const stopped = await stopRun(state);
    (stopped.action === "stopped" ? process.stdout : process.stderr).write(
      `launch: ${stopped.message}\n`,
    );
    if (stopped.action === "refused" || stopped.action === "incomplete") {
      process.exit(2);
    }
    await waitFor(async () => !(await tcpOpen(port)), 15_000);
  } else if (!live.gone) {
    process.stderr.write(
      `launch: refusing to replace run ${state.runId}: ${live.problem}\n`,
    );
    process.exit(2);
  }
}

if (await tcpOpen(port)) {
  const initial = await checkHealth(port);
  process.stdout.write(`${initial.lines.join("\n")}\n`);
  if (!refuseForeignNext()) {
    process.stderr.write(
      `launch: port ${port} is already taken by a process this skill did not start. Refusing to start a second server.\n`,
    );
  }
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

// next dev, the npm run dev script, run directly so the supervisor's child is
// the server itself.
const nextBin = require.resolve("next/dist/bin/next");
const appEnv = {
  ...process.env,
  SCRUTINIX_TEST_FIXTURES: "1",
  SHARE_SIGNING_SECRET: E2E_SHARE_SIGNING_SECRET,
  SHARE_SIGNING_SECRET_PREVIOUS: "",
  NEXT_TELEMETRY_DISABLED: "1",
  UPSTASH_REDIS_REST_URL: "",
  UPSTASH_REDIS_REST_TOKEN: "",
  KV_REST_API_URL: "",
  KV_REST_API_TOKEN: "",
};

process.stdout.write("launch: starting the supervisor and next dev\n");
let started;
try {
  started = await startSupervisor({
    command: process.execPath,
    args: [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    env: appEnv,
    port,
    record: { fixtureMode: true },
    lock,
  });
} catch (error) {
  process.stderr.write(
    `launch: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
}
const { state: run } = started;
if (!started.status) {
  failWithLog("the supervisor did not answer", run.supervisorLog);
  process.exit(1);
}
process.stdout.write(
  `launch: run ${run.runId}, supervisor pid ${run.supervisorPid}, next dev pid ${started.status.app.pid}\n`,
);

// Ready means a process in the supervisor's group holds 127.0.0.1:<port>.
const up = await waitFor(async () => {
  const reply = await supervisorRequest(run, "status");
  if (!reply.proven) return "dead";
  if (reply.body.app.exit) return "exited";
  const { own, foreign } = reply.body.listeners;
  if (foreign.length) return "taken";
  return own.some((listener) => listener.address === "127.0.0.1")
    ? "ready"
    : "";
}, 180_000);

if (up !== "ready") {
  const reasons = {
    dead: "the supervisor stopped answering",
    exited: "next dev exited",
    taken: `another process took port ${port}`,
    "": "next dev timed out",
  };
  failWithLog(reasons[up] ?? "next dev failed", run.appLog);
  await captureSettledNextEnv();
  process.exit(1);
}

const deadline = Date.now() + 180_000;
let report = await checkHealth(port);
while (
  !report.ok &&
  report.code !== "foreign-server" &&
  report.code !== "foreign-next" &&
  Date.now() < deadline
) {
  const reply = await supervisorRequest(run, "status");
  if (!reply.proven || reply.body.app.exit) {
    failWithLog("next dev exited", run.appLog);
    await captureSettledNextEnv();
    process.exit(1);
  }
  await delay(1_000);
  report = await checkHealth(port);
}

await captureSettledNextEnv();
process.stdout.write(`${report.lines.join("\n")}\n`);
if (!report.ok) {
  failWithLog(`instance is NOT_READY (${report.code})`, run.appLog);
  process.exit(2);
}
process.stdout.write(`launch: READY ${baseUrl}\n`);
process.stdout.write(`launch: evidence directory ${evidenceDir}\n`);
