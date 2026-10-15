#!/usr/bin/env node
import { setTimeout as delay } from "node:timers/promises";

import {
  canonicalPath,
  cmdline,
  evidenceDir,
  killTmuxSession,
  readState,
  repoRoot,
  restoreTrackedDevFiles,
  sameCheckout,
  sessionExists,
  tcpOpen,
  writeState,
} from "./runtime.mjs";

const help = `verify-scrutinix cleanup

Stop only the tmux session and listener pids recorded in
/tmp/scrutinix-verify/run.json for this checkout. A run.json whose repoRoot
is a different checkout is left running. Evidence under
/tmp/scrutinix-verify/evidence is left in place. next-env.d.ts is restored
and Next.js agent-rule blocks are removed from AGENTS.md.

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
  restoreTrackedDevFiles();
  process.stdout.write(
    "cleanup: no run.json. Nothing recorded by verify:launch was stopped.\n",
  );
  process.stdout.write(`cleanup: evidence directory ${evidenceDir}\n`);
  process.exit(0);
}

if (!sameCheckout(state)) {
  restoreTrackedDevFiles();
  process.stdout.write(
    `cleanup: run.json belongs to ${state.repoRoot || "another checkout"}. Leaving that server running. This checkout is ${canonicalPath(repoRoot)}.\n`,
  );
  process.stdout.write(`cleanup: evidence directory ${evidenceDir}\n`);
  process.exit(0);
}

const sessions = Array.isArray(state.sessions) ? state.sessions : [];
const pids = Array.isArray(state.pids) ? state.pids : [];

for (const name of sessions) {
  if (typeof name !== "string" || !sessionExists(name)) continue;
  const killed = killTmuxSession(name);
  process.stdout.write(
    killed
      ? `cleanup: stopped tmux session ${name}\n`
      : `cleanup: failed to stop tmux session ${name}\n`,
  );
}

await delay(1_000);

for (const pid of pids) {
  if (!Number.isInteger(pid) || pid <= 0) continue;
  const command = cmdline(pid);
  if (!command) continue;
  const ownedCommand =
    command.includes(repoRoot) ||
    command.includes("next") ||
    command.includes("scrutinix-verify");
  if (!ownedCommand) {
    process.stdout.write(
      `cleanup: leaving pid ${pid} alone (command does not match this launch)\n`,
    );
    continue;
  }
  try {
    process.kill(pid, "SIGTERM");
    process.stdout.write(`cleanup: sent SIGTERM to pid ${pid}\n`);
  } catch {
    process.stdout.write(`cleanup: pid ${pid} was already gone\n`);
  }
}

await delay(500);
const stillOpen = await tcpOpen(3000);
writeState({
  ...state,
  repoRoot: canonicalPath(repoRoot),
  sessions: [],
  pids: [],
  stoppedAt: new Date().toISOString(),
});
restoreTrackedDevFiles();

process.stdout.write(`cleanup: evidence directory ${evidenceDir}\n`);
if (stillOpen) {
  process.stdout.write(
    "cleanup: port 3000 is still open. This skill did not kill any process it does not have recorded.\n",
  );
}
