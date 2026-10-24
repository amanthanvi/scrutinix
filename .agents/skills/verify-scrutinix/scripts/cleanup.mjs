#!/usr/bin/env node
import { setTimeout as delay } from "node:timers/promises";

import {
  baseUrlParts,
  canonicalPath,
  defaultBaseUrl,
  evidenceDir,
  hasNextEnvRecord,
  readState,
  repoRoot,
  restoreNextEnvSnapshot,
  sameCheckout,
  stopRecordedProcess,
  stopRecordedSession,
  tcpOpen,
  writeState,
} from "./runtime.mjs";

const help = `verify-scrutinix cleanup

Stop only what verify:launch recorded in run.json for this checkout. Each
recorded tmux session and listener is re-read first and stopped only when its
identity still matches what launch recorded:
  - tmux session: session id, creation time, and pane process (pid, start
    time, cwd). The session name alone is never enough.
  - listener: pid, start time, executable, and cwd, which must be this
    checkout.
Anything that differs (a reused pid, a reused session name, a process serving
another checkout) is left running, and cleanup says why. Nothing is stopped
by name or pattern. A run.json whose repoRoot is a different checkout is left
alone.

Evidence under the evidence directory is left in place. next-env.d.ts is
restored to the pre-launch snapshot only when it still matches what this run
wrote. Otherwise it is left unchanged, the snapshot bytes are saved under the
evidence directory, and that path is printed. An unfinished snapshot, one
taken before the run recorded what it wrote, is dropped too, including when
run.json is missing.

Usage:
  node .agents/skills/verify-scrutinix/scripts/cleanup.mjs
  npm run verify:cleanup
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(help);
  process.exit(0);
}

const state = readState();
if (!state) {
  if (hasNextEnvRecord()) {
    const declaration = restoreNextEnvSnapshot();
    if (declaration.warning) {
      process.stderr.write(`${declaration.warning}\n`);
    }
  }
  process.stdout.write(
    "cleanup: no run.json. Nothing recorded by verify:launch was stopped.\n",
  );
  process.stdout.write(`cleanup: evidence directory ${evidenceDir}\n`);
  process.exit(0);
}

if (!sameCheckout(state)) {
  process.stdout.write(
    `cleanup: run.json belongs to ${state.repoRoot || "another checkout"}. Leaving that server running. This checkout is ${canonicalPath(repoRoot)}.\n`,
  );
  process.stdout.write(`cleanup: evidence directory ${evidenceDir}\n`);
  process.exit(0);
}

const recordedSessions = Array.isArray(state.sessions) ? state.sessions : [];
// Older launches wrote bare pids. They carry no identity, so they are refused.
const recordedListeners = [
  ...(Array.isArray(state.listeners) ? state.listeners : []),
  ...(Array.isArray(state.pids) ? state.pids : []),
];
let refused = 0;

function report(result) {
  if (result.action === "refused" || result.action === "failed") {
    refused += 1;
    process.stderr.write(`cleanup: ${result.message}\n`);
    return;
  }
  process.stdout.write(`cleanup: ${result.message}\n`);
}

for (const session of recordedSessions) {
  report(stopRecordedSession(session));
}

if (recordedSessions.length) await delay(1_000);

for (const listener of recordedListeners) {
  report(stopRecordedProcess(listener));
}

await delay(500);
const { port } = baseUrlParts(
  typeof state.baseUrl === "string" && state.baseUrl
    ? state.baseUrl
    : defaultBaseUrl,
);
const stillOpen = await tcpOpen(port);
// Refused entries are dropped too: they no longer describe anything this
// checkout started, so a later cleanup must not treat them as owned.
writeState({
  ...state,
  repoRoot: canonicalPath(repoRoot),
  sessions: [],
  listeners: [],
  pids: [],
  stoppedAt: new Date().toISOString(),
});
const declaration = restoreNextEnvSnapshot();
if (declaration.action === "restored") {
  process.stdout.write(
    "cleanup: restored next-env.d.ts to the pre-launch snapshot.\n",
  );
} else if (declaration.warning) {
  process.stderr.write(`${declaration.warning}\n`);
}

process.stdout.write(`cleanup: evidence directory ${evidenceDir}\n`);
if (refused) {
  process.stderr.write(
    `cleanup: left ${refused} recorded process${refused === 1 ? "" : "es"} running because the identity no longer matches this launch. Check them yourself before stopping anything.\n`,
  );
}
if (stillOpen) {
  process.stdout.write(
    `cleanup: port ${port} is still open. This skill stops only processes whose recorded identity still matches.\n`,
  );
}
process.exit(refused ? 1 : 0);
