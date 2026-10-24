#!/usr/bin/env node
// The run supervisor. launch.mjs starts it detached, so it leads its own
// session and process group, and passes its config (including the run token)
// on stdin. It spawns the app in that same group and holds the child handle.
// Requests arrive on a 0600 Unix socket in the private state directory and
// must carry an HMAC of the run token; every reply carries one too.
//
// Stopping signals the supervisor's own group, -process.pid. While the
// supervisor is alive that group id cannot belong to anything else, and only
// processes in this session (descendants of the supervisor) can be in it. So
// a stop reaches only what this run started: no pid, tmux id, or cwd is
// looked up again. A descendant that leaves the group (setsid, or a detached
// spawn) is out of reach; stopRun reports it when it still holds the run's
// port or socket.
import { spawn } from "node:child_process";
import { chmodSync, closeSync, lstatSync, unlinkSync } from "node:fs";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import {
  clientAuth,
  openPrivateLog,
  portListeners,
  processGroup,
  processGroupMembers,
  sameDigest,
  serverProof,
} from "./runtime.mjs";

function log(message) {
  process.stdout.write(`${new Date().toISOString()} supervisor: ${message}\n`);
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
const config = JSON.parse(input);
const { token, runId, root, port, command, args, env, appLog, socket } = config;
const lingerMs = Number(config.lingerMs) || 120_000;

if (processGroup(process.pid) !== process.pid) {
  log(
    "not a process group leader. Refusing to start an app it could not stop.",
  );
  process.exit(1);
}

let app = null;
let appExit = null;
let appExitedAt = 0;

// Started only once the socket is listening, so there is never an app that
// no one can ask this supervisor to stop.
function startApp() {
  const appFd = openPrivateLog(appLog);
  app = spawn(command, args, {
    cwd: root,
    env,
    stdio: ["ignore", appFd, appFd],
  });
  closeSync(appFd);
  app.once("error", (error) => {
    appExit ??= {
      code: null,
      signal: null,
      error: error.code ?? "spawn failed",
    };
    appExitedAt ||= Date.now();
  });
  // Until "exit" fires the child is unreaped, so app.pid cannot be reused.
  app.once("exit", (code, signal) => {
    appExit = { code, signal };
    appExitedAt = Date.now();
  });
  log(`run ${runId}: app pid ${app.pid}, process group ${process.pid}`);
}

function members() {
  return processGroupMembers(process.pid).filter((pid) => pid !== process.pid);
}

// Listeners on the run's port, split by whether they are in this group.
function classifyListeners() {
  const own = [];
  const foreign = [];
  for (const listener of portListeners(port)) {
    const inGroup =
      listener.pid !== null && processGroup(listener.pid) === process.pid;
    (inGroup ? own : foreign).push(listener);
  }
  return { own, foreign };
}

let stopping = null;

function signalGroup(signal) {
  try {
    process.kill(-process.pid, signal);
  } catch {
    // The group is this process's own; ESRCH cannot happen while it runs.
  }
}

async function until(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(100);
  }
  return predicate();
}

function stopGroup() {
  stopping ??= (async () => {
    log("stopping: SIGTERM to its own process group");
    signalGroup("SIGTERM");
    const drained = () =>
      (app === null || appExit !== null) && members().length === 0;
    if (!(await until(drained, 10_000))) {
      if (app !== null && appExit === null) app.kill("SIGKILL");
      await until(drained, 3_000);
    }
    return members().length;
  })();
  return stopping;
}

let server;

function finish(leftover) {
  server?.close();
  try {
    unlinkSync(socket);
  } catch {
    // Already gone.
  }
  if (leftover > 0) {
    log(`${leftover} group member(s) ignored SIGTERM. SIGKILL to the group.`);
    signalGroup("SIGKILL");
  }
  log("exiting");
  process.exit(0);
}

// SIGTERM from the group signal reaches this process too; it is ignored once
// a stop is under way. A SIGTERM, SIGINT, or SIGHUP from anyone else is a
// stop request: `kill <supervisor pid>` is the manual way to end a run.
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    if (stopping) return;
    stopGroup().then(finish);
  });
}

function status() {
  return {
    ok: true,
    runId,
    supervisorPid: process.pid,
    port,
    app: { pid: app?.pid ?? null, exit: appExit },
    stopping: Boolean(stopping),
    listeners: classifyListeners(),
  };
}

function reply(connection, nonce, body) {
  const proof = serverProof(token, nonce, body);
  connection.end(`${JSON.stringify({ body, proof })}\n`);
}

async function handle(connection, line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    connection.end(
      `${JSON.stringify({ body: { ok: false, error: "bad request" } })}\n`,
    );
    return;
  }
  const { op, nonce, auth } = request ?? {};
  if (
    typeof op !== "string" ||
    typeof nonce !== "string" ||
    nonce.length > 100 ||
    typeof auth !== "string" ||
    !sameDigest(auth, clientAuth(token, op, nonce))
  ) {
    log("refused a request without the run token");
    connection.end(
      `${JSON.stringify({ body: { ok: false, error: "unauthorized" } })}\n`,
    );
    return;
  }
  if (op === "status") {
    reply(connection, nonce, status());
    return;
  }
  if (op === "stop") {
    const leftover = await stopGroup();
    connection.once("close", () => finish(leftover));
    reply(connection, nonce, {
      ok: true,
      runId,
      supervisorPid: process.pid,
      stopped: true,
      leftover,
    });
    return;
  }
  reply(connection, nonce, { ok: false, runId, error: "unknown op" });
}

server = net.createServer((connection) => {
  let buffer = "";
  connection.setEncoding("utf8");
  connection.setTimeout(30_000, () => connection.destroy());
  connection.on("error", () => {});
  connection.on("data", (chunk) => {
    buffer += chunk;
    if (buffer.length > 65_536) {
      connection.destroy();
      return;
    }
    const end = buffer.indexOf("\n");
    if (end === -1) return;
    connection.removeAllListeners("data");
    void handle(connection, buffer.slice(0, end));
  });
});

server.once("error", (error) => {
  log(
    `cannot listen on its socket (${error.code ?? "error"}). No app started.`,
  );
  process.exit(1);
});
server.listen(socket, () => {
  chmodSync(socket, 0o600);
  const stat = lstatSync(socket);
  log(`listening on its socket (mode 0${(stat.mode & 0o777).toString(8)})`);
  startApp();
});

// When the app exits on its own and its group is empty, linger so launch and
// cleanup can still read the exit, then go.
const idle = setInterval(() => {
  if (stopping || app === null || appExit === null) return;
  if (members().length) return;
  if (Date.now() - appExitedAt < lingerMs) return;
  clearInterval(idle);
  log("app exited and the group is empty");
  finish(0);
}, 1_000);
