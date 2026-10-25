#!/usr/bin/env node
import { setTimeout as delay } from "node:timers/promises";

import {
  acquireStateLock,
  canonicalPath,
  defaultPort,
  evidenceDir,
  hasNextEnvRecord,
  legacyPids,
  legacyState,
  loadState,
  portDetails,
  releaseStateLock,
  repoRoot,
  restoreNextEnvSnapshot,
  sameCheckout,
  stateDir,
  stopRun,
  tcpOpen,
  validPort,
  writeState,
} from "./runtime.mjs";

const help = `verify-scrutinix cleanup

Stop only what verify:launch started for this checkout. Before reading
anything, cleanup checks the state directory: a real directory owned by this
user with mode 0700, under ancestors nobody else can swap out, holding a
run.json that is a regular file (not a symlink) nobody else can write. If any
check fails, cleanup stops nothing and exits 2.

Then it takes the state lock (verify.lock; exit 2 if another launch or
cleanup holds it, which is never taken over), reads run.json again, and asks
the run's supervisor, over the private socket and with the run token, to
stop. The supervisor signals its own process group: next dev and whatever
next dev started that is still in the group. A process that left the group
(setsid, or a detached spawn) is not stopped. Afterwards cleanup checks that
the run's socket no longer answers and its port is free; if either still
answers, it names the listener (pid, start time, executable, cwd), reports
the cleanup as incomplete, and exits 1. Cleanup itself never signals a pid,
never looks processes up by name, pattern, cwd, port, or tmux session, and
leaves anything else running. When the supervisor is gone and the recorded
port is still open, cleanup names the listener and exits 1. A run.json for a
different checkout is left alone.

Cleanup is the only way to stop a run. It drops the supervisor pid from
run.json with the token; never signal a pid read from run.json. Stop a
process cleanup reported only after checking its pid, start time,
executable, and cwd yourself.

Evidence under the evidence directory is left in place. next-env.d.ts is
restored to the pre-launch snapshot only when it still matches what this run
wrote. Otherwise it is left unchanged, the snapshot bytes are saved under the
evidence directory, and that path is printed. An unfinished snapshot, one
taken before the run recorded what it wrote, is dropped too, including when
run.json is missing.

Usage:
  node .agents/skills/verify-scrutinix/scripts/cleanup.mjs
  npm run verify:cleanup

cleanup takes no arguments: the port and run come from run.json.
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(help);
  process.exit(0);
}
if (process.argv.length > 2) {
  process.stderr.write(
    "cleanup: takes no arguments. The run and its port come from run.json.\n",
  );
  process.exit(2);
}

function refuse(problem) {
  process.stderr.write(
    `cleanup: refusing to read ${stateDir}: ${problem}. Nothing was stopped.\n`,
  );
  process.exit(2);
}

// Validate first. Nothing in an unsafe directory is parsed or acted on.
const checked = loadState();
if (checked.problem) refuse(checked.problem);
if (checked.missingDir) {
  process.stdout.write(
    `cleanup: no state directory at ${stateDir}. Nothing recorded by verify:launch was stopped.\n`,
  );
  process.exit(0);
}

// Then take the state lock and read run.json again under it, so a launch
// running at the same time cannot change the run between the read and the stop.
let lock;
try {
  lock = acquireStateLock("cleanup");
} catch (error) {
  process.stderr.write(
    `cleanup: ${error instanceof Error ? error.message : String(error)} Nothing was stopped.\n`,
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
const { state, problem } = loadState();
if (problem) refuse(problem);

function restoreDeclaration() {
  const declaration = restoreNextEnvSnapshot();
  if (declaration.action === "restored") {
    process.stdout.write(
      "cleanup: restored next-env.d.ts to the pre-launch snapshot.\n",
    );
  } else if (declaration.warning) {
    process.stderr.write(`${declaration.warning}\n`);
  }
}

if (!state) {
  if (hasNextEnvRecord()) restoreDeclaration();
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

let leftRunning = 0;
let reported = false;

if (legacyState(state)) {
  const pids = legacyPids(state);
  leftRunning += 1;
  process.stderr.write(
    `cleanup: run.json was written by the tmux version of this skill${pids.length ? ` (recorded pids ${pids.join(", ")})` : ""}. This version stops only what its own supervisor started, so those were left running. Check them yourself before stopping anything.\n`,
  );
} else if (state.token) {
  const result = await stopRun(state);
  if (result.action === "refused") {
    leftRunning += 1;
    process.stderr.write(`cleanup: ${result.message}\n`);
  } else if (result.action === "incomplete") {
    // Something still answers. It is reported, and the token is kept while
    // the socket answers, so nothing else is mistaken for this run.
    if (result.socket) leftRunning += 1;
    reported = result.port;
    process.stderr.write(`cleanup: ${result.message}\n`);
  } else {
    process.stdout.write(`cleanup: ${result.message}\n`);
  }
} else {
  process.stdout.write("cleanup: this run was already stopped.\n");
}

await delay(300);
const port = validPort(state.port) ? state.port : defaultPort;
const stillOpen = await tcpOpen(port);

// The token and the supervisor pid are dropped with the run: the supervisor
// is gone, a later cleanup must not treat this record as a live run, and a
// pid that outlived its process names nothing.
if (!legacyState(state) && leftRunning === 0) {
  const { token: _token, supervisorPid: _pid, ...rest } = state;
  writeState({ ...rest, stoppedAt: new Date().toISOString() });
}
restoreDeclaration();

process.stdout.write(`cleanup: evidence directory ${evidenceDir}\n`);
if (stillOpen && !reported) {
  const owners = portDetails(port);
  process.stderr.write(
    `cleanup: port ${port} is still open, and this skill did not stop its listener. It stops only its own supervisor's process group.${owners ? `\n${owners}` : ""}\n`,
  );
}
const incomplete = Boolean(leftRunning || stillOpen || reported);
if (incomplete) {
  process.stderr.write(
    'cleanup: nothing else was stopped. Before you stop a process yourself, check its pid, start time, executable, and cwd freshly (SKILL.md, "Another next dev"). Never signal a pid read from run.json.\n',
  );
}
process.exit(incomplete ? 1 : 0);
