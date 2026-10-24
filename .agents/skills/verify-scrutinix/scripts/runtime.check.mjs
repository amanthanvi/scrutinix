import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
// Under /tmp, not os.tmpdir(): Unix socket paths are limited to ~104 bytes,
// and macOS's per-user temp directory is long.
const scratch = mkdtempSync("/tmp/sxv-");
const stateDir = path.join(scratch, "state");
const evidenceDir = path.join(stateDir, "evidence");
process.env.VERIFY_STATE_DIR = stateDir;
process.env.VERIFY_EVIDENCE_DIR = evidenceDir;
delete process.env.E2E_BASE_URL;

const runtime = await import("./runtime.mjs");

const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    process.stdout.write(`ok ${name}\n`);
    return;
  }
  failures.push(detail ? `${name}: ${detail}` : name);
  process.stdout.write(`not ok ${name}${detail ? `: ${detail}` : ""}\n`);
}

function assertPrivate(dir) {
  const stat = lstatSync(dir);
  const mode = stat.mode & 0o777;
  check(`${dir} mode 0700`, mode === 0o700, `mode 0${mode.toString(8)}`);
  check(
    `${path.basename(dir)} owner`,
    stat.uid === process.getuid(),
    `uid ${stat.uid}`,
  );
}

function envFor(dir, extra = {}) {
  return {
    ...process.env,
    VERIFY_STATE_DIR: dir,
    VERIFY_EVIDENCE_DIR: path.join(dir, "evidence"),
    ...extra,
  };
}

const children = [];
const groups = [];
const orphanGroups = new Set();
const supervised = [];

// CLI runs are asynchronous so servers in this process (the forged socket)
// keep answering while the child runs.
function runCli(script, args = [], env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(scriptDir, script), ...args],
      {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const output = (result) =>
  `${result.status}\n${result.stdout}\n${result.stderr}`;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await delay(50);
  }
  return Boolean(await predicate());
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function privateDir(name) {
  const dir = path.join(scratch, name);
  mkdirSync(dir, { mode: 0o700 });
  mkdirSync(path.join(dir, "evidence"), { mode: 0o700 });
  return dir;
}

const checkout = runtime.canonicalPath(runtime.repoRoot);
const token = (fill) => fill.repeat(64);

// ---- Base URLs --------------------------------------------------------------

for (const script of ["launch.mjs", "doctor.mjs"]) {
  const invalid = await runCli(script, ["--base-url", "not a url"]);
  check(
    `${script} rejects invalid base url`,
    invalid.status === 2 &&
      invalid.stderr.includes("not a valid URL") &&
      !output(invalid).includes("TypeError"),
    output(invalid),
  );
  const empty = await runCli(script, ["--base-url", ""]);
  check(
    `${script} rejects empty base url`,
    empty.status === 2 && empty.stderr.includes("needs a URL"),
    output(empty),
  );
  const missing = await runCli(script, ["--base-url"]);
  check(
    `${script} rejects missing base url`,
    missing.status === 2 && missing.stderr.includes("needs a URL"),
    output(missing),
  );
  const equalsEmpty = await runCli(script, ["--base-url="]);
  check(
    `${script} rejects empty equals base url`,
    equalsEmpty.status === 2 && equalsEmpty.stderr.includes("needs a URL"),
    output(equalsEmpty),
  );
  const equalsInvalid = await runCli(script, ["--base-url=not-a-url"]);
  check(
    `${script} rejects invalid equals base url`,
    equalsInvalid.status === 2 &&
      equalsInvalid.stderr.includes("not a valid URL") &&
      !output(equalsInvalid).includes("TypeError"),
    output(equalsInvalid),
  );
  // Errors never echo the input: it can carry credentials.
  for (const [label, raw, secret] of [
    [
      "credentials",
      "http://user:SYNTH-cred-123@127.0.0.1:3000",
      "SYNTH-cred-123",
    ],
    ["malformed", "http://[bad token=SYNTH-tok-456", "SYNTH-tok-456"],
    ["query", "http://127.0.0.1:3000/?token=SYNTH-q-789", "SYNTH-q-789"],
    ["fragment", "http://127.0.0.1:3000/#SYNTH-frag-790", "SYNTH-frag-790"],
    ["path", "http://127.0.0.1:3000/SYNTH-path-791", "SYNTH-path-791"],
  ]) {
    const refused = await runCli(script, [`--base-url=${raw}`]);
    check(
      `${script} rejects a ${label} base url without echoing it`,
      refused.status === 2 &&
        !output(refused).includes(secret) &&
        !output(refused).includes("user:"),
      output(refused),
    );
  }
}
const fromEnv = await runCli("doctor.mjs", [], {
  ...process.env,
  E2E_BASE_URL: "http://u:SYNTH-env-792@127.0.0.1:3000",
});
check(
  "doctor rejects a credentialed E2E_BASE_URL without echoing it",
  fromEnv.status === 2 &&
    fromEnv.stderr.includes("E2E_BASE_URL") &&
    !output(fromEnv).includes("SYNTH-env-792"),
  output(fromEnv),
);
const equalsParsed = runtime.parseCliBaseUrl(
  ["node", "launch.mjs", "--base-url=http://127.0.0.1:3000"],
  {},
);
check(
  "equals base url is parsed",
  equalsParsed.ok === true && equalsParsed.baseUrl === "http://127.0.0.1:3000",
  equalsParsed.baseUrl,
);
const equalsOther = await runCli("launch.mjs", [
  "--base-url=http://example.com",
]);
check(
  "equals base url does not fall back",
  equalsOther.status === 2 &&
    equalsOther.stderr.includes("refusing http://example.com"),
  output(equalsOther),
);
const hint = runtime.foreignNextStopHint(3000);
check(
  "stop hint names exact-pid checks and never a command line",
  hint.includes("lsof -nP -iTCP:3000") &&
    hint.includes("lstart") &&
    hint.includes("kill <pid>") &&
    !hint.includes("cmdline") &&
    hint.includes("Do not kill by name"),
  hint,
);

// ---- Private state directory ------------------------------------------------

runtime.ensureDirs();
assertPrivate(stateDir);
assertPrivate(evidenceDir);

chmodSync(stateDir, 0o755);
let rejectedLoose = false;
try {
  runtime.ensureDirs();
} catch (error) {
  rejectedLoose = error instanceof Error && error.message.includes("mode");
}
check("reject group-readable state dir", rejectedLoose);
chmodSync(stateDir, 0o700);

const linked = path.join(scratch, "linked");
const target = path.join(scratch, "link-target");
mkdirSync(target, { mode: 0o700 });
symlinkSync(target, linked);
check(
  "reject symlink state dir",
  runtime.privateDirProblem(linked).includes("real directory"),
  runtime.privateDirProblem(linked),
);

const loose = path.join(scratch, "loose");
mkdirSync(loose);
chmodSync(loose, 0o777);
const underLoose = path.join(loose, "st");
mkdirSync(underLoose, { mode: 0o700 });
check(
  "reject a state dir under a group-writable, non-sticky directory",
  runtime.privateDirProblem(underLoose).includes("not sticky"),
  runtime.privateDirProblem(underLoose),
);

const runRecord = (extra = {}) => ({
  version: 2,
  runId: "abcdef012345",
  token: token("a"),
  repoRoot: checkout,
  baseUrl: "http://127.0.0.1:3000",
  port: 3000,
  ...extra,
});

const symlinkedRun = privateDir("symlinked-run");
const elsewhere = path.join(scratch, "elsewhere.json");
writeFileSync(elsewhere, JSON.stringify(runRecord()), { mode: 0o600 });
symlinkSync(elsewhere, path.join(symlinkedRun, "run.json"));
check(
  "reject a symlinked run.json",
  runtime.loadState(symlinkedRun).problem.includes("symlink"),
  runtime.loadState(symlinkedRun).problem,
);
const writableRun = privateDir("writable-run");
writeFileSync(path.join(writableRun, "run.json"), JSON.stringify(runRecord()));
chmodSync(path.join(writableRun, "run.json"), 0o666);
check(
  "reject a run.json others can write",
  runtime
    .loadState(writableRun)
    .problem.includes("writable by group or others"),
  runtime.loadState(writableRun).problem,
);

// ---- Processes this check starts --------------------------------------------

function track(child) {
  children.push(child);
  return child;
}

// Stops everything this check started, only through handles that keep the
// pid from being reused: ChildProcess.kill is a no-op once the child is
// reaped, and a group is signalled only while its leader is still unreaped.
// A supervisor's own stop path is SIGTERM. Also runs when the check itself is
// interrupted, so a killed run leaves nothing behind.
function stopGroup(leader, signal = "SIGTERM") {
  if (leader.exitCode !== null || leader.signalCode !== null) return;
  try {
    process.kill(-leader.pid, signal);
  } catch {
    // The group is already empty.
  }
}

// An orphaned run's group outlives its supervisor. Its id stays held while
// any member lives, so it still names exactly those members.
function stopOrphans() {
  for (const pgid of orphanGroups) {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  orphanGroups.clear();
}

function teardown() {
  for (const { child } of supervised) child?.kill("SIGTERM");
  stopOrphans();
  for (const leader of groups) stopGroup(leader);
  for (const child of children) child.kill("SIGTERM");
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    teardown();
    rmSync(scratch, { recursive: true, force: true });
    process.exit(1);
  });
}

function sleeper(cwd) {
  return track(
    spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd,
      stdio: "ignore",
    }),
  );
}

// A stand-in app: optionally serves the three pages doctor reads, and starts
// a grandchild so a stop is seen to reach the whole group.
const fakeApp = path.join(scratch, "fake-app.cjs");
writeFileSync(
  fakeApp,
  `const http = require("http");
const fs = require("fs");
const { spawn } = require("child_process");
const [port, mode, pidFile] = process.argv.slice(2);
const pages = {
  "/": "<main>URL to analyze</main>",
  "/about": "<h1>How a scan becomes a verdict.</h1>",
  "/privacy": '<header><a aria-current="page" href="/privacy">Privacy</a></header><main id="main-content"><h1>Privacy</h1></main>',
};
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
const ready = () => fs.writeFileSync(pidFile, JSON.stringify({ app: process.pid, grandchild: grandchild.pid }));
if (mode === "html") {
  http
    .createServer((req, res) => {
      const body = pages[req.url];
      res.writeHead(body ? 200 : 404, { "content-type": "text/html" });
      res.end(body || "not found");
    })
    .listen(Number(port), "127.0.0.1", ready);
} else {
  ready();
}
setInterval(() => {}, 1000);
`,
);

async function readPids(file) {
  await waitUntil(() => existsSync(file));
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { app: 0, grandchild: 0 };
  }
}

// A server started by this check, not by any supervisor: same executable and
// same cwd (this checkout) as the app. The old design would have owned it.
// It leads its own group, so teardown can stop it with its grandchild.
async function stranger(port, name) {
  const pidFile = path.join(scratch, `${name}.json`);
  const child = spawn(
    process.execPath,
    [fakeApp, String(port), "html", pidFile],
    { cwd: runtime.repoRoot, stdio: "ignore", detached: true },
  );
  groups.push(child);
  const pids = await readPids(pidFile);
  await waitUntil(() => runtime.tcpOpen(port));
  return { child, pids };
}

async function supervise(dir, port, mode, name, extra = {}) {
  const pidFile = path.join(scratch, `${name}.json`);
  const entry = { dir, state: null, child: null };
  supervised.push(entry);
  const started = await runtime.startSupervisor({
    command: process.execPath,
    args: [fakeApp, String(port), mode, pidFile],
    env: process.env,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    dir,
    // Held from the moment of spawn, so an interrupted check still stops it.
    onSpawn: (child) => {
      entry.child = child;
    },
    ...extra,
  });
  entry.state = started.state;
  const pids = await readPids(pidFile);
  if (mode === "html") await waitUntil(() => runtime.tcpOpen(port));
  return { ...started, pids };
}

const self = runtime.processIdentity(process.pid);
check(
  "own identity has start time, executable, cwd",
  Boolean(self?.startTime && self.executable && self.cwd),
  JSON.stringify(self),
);
check(
  "identity of a missing pid is null",
  runtime.processIdentity(2 ** 22 + 12345) === null &&
    runtime.processIdentity(0) === null &&
    runtime.processIdentity(-1) === null,
);
check(
  "describeProcess prints selected fields only",
  /^pid \d+, started .+, executable .+, cwd .+$/.test(
    runtime.describeProcess(self),
  ),
  runtime.describeProcess(self),
);

const listenProbe = net.createServer();
await new Promise((resolve) => {
  listenProbe.listen(0, "127.0.0.1", resolve);
});
const probePort = listenProbe.address().port;
check(
  "port listeners find this process on 127.0.0.1",
  runtime
    .portListeners(probePort)
    .some(
      (listener) =>
        listener.pid === process.pid && listener.address === "127.0.0.1",
    ),
  JSON.stringify(runtime.portListeners(probePort)),
);
const details = runtime.portDetails(probePort);
check(
  "port details are identity fields, not a command line",
  details.includes(`pid ${process.pid}, started `) &&
    !details.includes("runtime.check.mjs"),
  details,
);
listenProbe.close();

// ---- Finding 1: nothing in an unsafe state directory is acted on -------------

// A socket in the state directory that records every connection. Cleanup
// must not connect to it unless the directory and run.json pass every check.
async function forgedSocket(dir) {
  const connections = { count: 0 };
  const server = net.createServer((connection) => {
    connections.count += 1;
    connection.on("error", () => {});
    connection.end(
      `${JSON.stringify({ body: { ok: true, runId: "abcdef012345", supervisorPid: 1, leftover: 0 }, proof: "0".repeat(64) })}\n`,
    );
  });
  await new Promise((resolve) =>
    server.listen(runtime.socketPath(dir), resolve),
  );
  return { connections, close: () => server.close() };
}

const victim = sleeper(runtime.repoRoot);
await waitUntil(() => runtime.processIdentity(victim.pid)?.cwd);
const victimIdentity = runtime.processIdentity(victim.pid);

const unsafeDir = privateDir("unsafe");
writeFileSync(
  path.join(unsafeDir, "run.json"),
  JSON.stringify(runRecord({ listeners: [victimIdentity] })),
  { mode: 0o600 },
);
const unsafeSocket = await forgedSocket(unsafeDir);
chmodSync(unsafeDir, 0o755);
const unsafeCleanup = await runCli("cleanup.mjs", [], envFor(unsafeDir));
check(
  "cleanup refuses a 0755 state dir before reading it, and the process survives",
  unsafeCleanup.status === 2 &&
    unsafeCleanup.stderr.includes("refusing to read") &&
    unsafeCleanup.stderr.includes("Nothing was stopped") &&
    unsafeSocket.connections.count === 0 &&
    alive(victim.pid),
  `${output(unsafeCleanup)}\nconnections ${unsafeSocket.connections.count}`,
);
unsafeSocket.close();

const symlinkSocket = await forgedSocket(symlinkedRun);
const symlinkCleanup = await runCli("cleanup.mjs", [], envFor(symlinkedRun));
check(
  "cleanup refuses a symlinked run.json and contacts nothing",
  symlinkCleanup.status === 2 &&
    symlinkSocket.connections.count === 0 &&
    alive(victim.pid),
  `${output(symlinkCleanup)}\nconnections ${symlinkSocket.connections.count}`,
);
symlinkSocket.close();

writeFileSync(path.join(underLoose, "run.json"), JSON.stringify(runRecord()), {
  mode: 0o600,
});
const looseCleanup = await runCli("cleanup.mjs", [], envFor(underLoose));
check(
  "cleanup refuses a state dir under a swappable parent",
  looseCleanup.status === 2 && looseCleanup.stderr.includes("not sticky"),
  output(looseCleanup),
);

// The same forged socket in a safe directory is reached, and then refused
// because it cannot prove the run token. This is the positive control for
// the zero-connection checks above.
const forgedDir = privateDir("forged");
writeFileSync(path.join(forgedDir, "run.json"), JSON.stringify(runRecord()), {
  mode: 0o600,
});
const forged = await forgedSocket(forgedDir);
const forgedCleanup = await runCli("cleanup.mjs", [], envFor(forgedDir));
check(
  "cleanup refuses a socket that cannot prove the run token",
  forgedCleanup.status === 1 &&
    forged.connections.count === 1 &&
    forgedCleanup.stderr.includes("did not prove") &&
    alive(victim.pid),
  `${output(forgedCleanup)}\nconnections ${forged.connections.count}`,
);
const forgedDoctor = await runtime.runOwnership("http://127.0.0.1:3000", {
  dir: forgedDir,
});
check(
  "a forged supervisor never makes doctor report owned",
  forgedDoctor.owned === false && forgedDoctor.reason.includes("did not prove"),
  JSON.stringify(forgedDoctor),
);
forged.close();

// A run.json from the tmux version: its identities are reported, never used.
const legacyDir = privateDir("legacy");
writeFileSync(
  path.join(legacyDir, "run.json"),
  JSON.stringify({
    repoRoot: checkout,
    baseUrl: "http://127.0.0.1:3000",
    sessions: [{ name: "scrutinix-verify-next-x", id: "$0", created: "1" }],
    listeners: [victimIdentity],
    pids: [victim.pid],
  }),
  { mode: 0o600 },
);
const legacyCleanup = await runCli("cleanup.mjs", [], envFor(legacyDir));
check(
  "cleanup leaves a tmux-era run.json's processes running",
  legacyCleanup.status === 1 &&
    legacyCleanup.stderr.includes("tmux version") &&
    legacyCleanup.stderr.includes(`recorded pids ${victim.pid}`) &&
    alive(victim.pid),
  output(legacyCleanup),
);

// ---- Findings 2 to 4: a run stops its own process group, nothing else --------

const portA = await freePort();
const portB = await freePort();
const strangerB = await stranger(portB, "stranger-b");
const outsider = sleeper("/tmp");
const runDir = privateDir("run");
const run = await supervise(runDir, portA, "html", "app-a");
check(
  "supervisor answers at start",
  Boolean(run.status),
  JSON.stringify(run.state),
);
const status = (
  await runtime.supervisorRequest(run.state, "status", { dir: runDir })
).body;
const supervisorPid = run.state.supervisorPid;
check(
  "supervisor leads its own process group, with the app and grandchild in it",
  runtime.processGroup(supervisorPid) === supervisorPid &&
    runtime.processGroup(run.pids.app) === supervisorPid &&
    runtime.processGroup(run.pids.grandchild) === supervisorPid,
  JSON.stringify({ supervisorPid, pids: run.pids }),
);
check(
  "status names the app's listener on 127.0.0.1 as its own",
  status?.listeners.own.some(
    (listener) =>
      listener.pid === run.pids.app && listener.address === "127.0.0.1",
  ) && status.listeners.foreign.length === 0,
  JSON.stringify(status),
);
check(
  "run.json and the socket are private",
  (lstatSync(path.join(runDir, "run.json")).mode & 0o777) === 0o600 &&
    (lstatSync(runtime.socketPath(runDir)).mode & 0o777) === 0o600,
);
check(
  "the stranger is outside the run's group",
  runtime.processGroup(strangerB.pids.app) !== supervisorPid,
);

const doctorOwn = await runCli(
  "doctor.mjs",
  ["--base-url", `http://127.0.0.1:${portA}`],
  envFor(runDir),
);
check(
  "doctor is READY and owned on the run's own port",
  doctorOwn.status === 0 &&
    doctorOwn.stdout.includes("doctor: READY") &&
    doctorOwn.stdout.includes(`owned by run ${run.state.runId}`),
  output(doctorOwn),
);
const doctorForeign = await runCli(
  "doctor.mjs",
  ["--base-url", `http://127.0.0.1:${portB}`, "--json"],
  envFor(runDir),
);
let foreignReport = {};
try {
  foreignReport = JSON.parse(doctorForeign.stdout);
} catch {
  foreignReport = {};
}
check(
  "doctor does not own a healthy server on another port, even from this checkout",
  doctorForeign.status === 2 &&
    foreignReport.owned === false &&
    foreignReport.code === "foreign-server" &&
    doctorForeign.stdout.includes(`serves http://127.0.0.1:${portA}`),
  output(doctorForeign),
);
const viaLocalhost = await runtime.runOwnership(`http://localhost:${portA}`, {
  dir: runDir,
});
check(
  "ownership needs the 127.0.0.1 origin the run was given",
  viaLocalhost.owned === false,
  JSON.stringify(viaLocalhost),
);

const wrongToken = await runtime.supervisorRequest(
  { ...run.state, token: token("b") },
  "stop",
  { dir: runDir },
);
await delay(300);
check(
  "a stop without the run token is refused and stops nothing",
  wrongToken.proven === false &&
    alive(run.pids.app) &&
    alive(run.pids.grandchild) &&
    alive(supervisorPid),
  JSON.stringify(wrongToken),
);

const runCleanup = await runCli("cleanup.mjs", [], envFor(runDir));
await waitUntil(
  () =>
    !alive(run.pids.app) &&
    !alive(run.pids.grandchild) &&
    !alive(supervisorPid),
);
check(
  "cleanup stops the app, its grandchild, and the supervisor",
  runCleanup.status === 0 &&
    runCleanup.stdout.includes(`stopped run ${run.state.runId}`) &&
    !alive(run.pids.app) &&
    !alive(run.pids.grandchild) &&
    !alive(supervisorPid),
  output(runCleanup),
);
check(
  "cleanup leaves a same-checkout server, its child, and an outside process running",
  alive(strangerB.pids.app) &&
    alive(strangerB.pids.grandchild) &&
    alive(outsider.pid) &&
    alive(victim.pid),
);
check(
  "the run's port is free and its socket and token are gone",
  !(await runtime.tcpOpen(portA)) &&
    !existsSync(runtime.socketPath(runDir)) &&
    runtime.readState(runDir)?.token === undefined,
);
const againCleanup = await runCli("cleanup.mjs", [], envFor(runDir));
check(
  "a second cleanup has nothing to stop",
  againCleanup.status === 0 && againCleanup.stdout.includes("already stopped"),
  output(againCleanup),
);

// Finding 3: another process from this checkout wins the port. The run does
// not own it, doctor does not report it, and cleanup leaves it running.
const portC = await freePort();
const strangerC = await stranger(portC, "stranger-c");
const takenDir = privateDir("taken");
const taken = await supervise(takenDir, portC, "silent", "app-c");
const takenOwnership = await runtime.runOwnership(`http://127.0.0.1:${portC}`, {
  dir: takenDir,
});
check(
  "a same-checkout listener that is not in the run's group is not owned",
  takenOwnership.owned === false &&
    takenOwnership.reason.includes("outside this run") &&
    takenOwnership.body?.listeners.foreign.some(
      (listener) => listener.pid === strangerC.pids.app,
    ),
  JSON.stringify(takenOwnership),
);
const takenDoctor = await runCli(
  "doctor.mjs",
  ["--base-url", `http://127.0.0.1:${portC}`],
  envFor(takenDir),
);
check(
  "doctor is not READY when a stranger holds the run's port",
  takenDoctor.status === 2 && takenDoctor.stdout.includes("foreign-server"),
  output(takenDoctor),
);
const takenCleanup = await runCli("cleanup.mjs", [], envFor(takenDir));
await waitUntil(() => !alive(taken.pids.app));
check(
  "cleanup stops only the run's app and reports the stranger on the port",
  takenCleanup.status === 1 &&
    !alive(taken.pids.app) &&
    !alive(taken.state.supervisorPid) &&
    alive(strangerC.pids.app) &&
    takenCleanup.stderr.includes(`port ${portC} is still open`) &&
    takenCleanup.stderr.includes(`pid ${strangerC.pids.app}, started`),
  output(takenCleanup),
);

// Finding 4: when the supervisor is gone, nothing is re-found by identity.
// The orphaned app keeps running and is reported.
const portD = await freePort();
const orphanDir = privateDir("orphan");
const orphan = await supervise(orphanDir, portD, "html", "app-d");
orphanGroups.add(orphan.state.supervisorPid);
orphan.child.kill("SIGKILL");
await waitUntil(() => !alive(orphan.state.supervisorPid));
const orphanCleanup = await runCli("cleanup.mjs", [], envFor(orphanDir));
check(
  "cleanup never signals a pid itself when the supervisor is gone",
  orphanCleanup.status === 1 &&
    orphanCleanup.stdout.includes("already gone") &&
    orphanCleanup.stderr.includes(`port ${portD} is still open`) &&
    alive(orphan.pids.app) &&
    alive(orphan.pids.grandchild),
  output(orphanCleanup),
);
stopOrphans();

// `kill <supervisor pid>` is the manual stop: the group goes with it.
const portE = await freePort();
const signalDir = privateDir("signal");
const signalled = await supervise(signalDir, portE, "html", "app-e");
signalled.child.kill("SIGTERM");
await waitUntil(
  () =>
    !alive(signalled.state.supervisorPid) &&
    !alive(signalled.pids.app) &&
    !alive(signalled.pids.grandchild),
);
check(
  "SIGTERM to the supervisor stops its group and removes its socket",
  !alive(signalled.state.supervisorPid) &&
    !alive(signalled.pids.app) &&
    !alive(signalled.pids.grandchild) &&
    !existsSync(runtime.socketPath(signalDir)),
);

// A run.json for another checkout is left alone entirely.
const otherCheckout = path.join(scratch, "other-checkout");
mkdirSync(otherCheckout);
const foreignDir = privateDir("foreign");
writeFileSync(
  path.join(foreignDir, "run.json"),
  JSON.stringify(runRecord({ repoRoot: otherCheckout })),
  { mode: 0o600 },
);
const foreignSocket = await forgedSocket(foreignDir);
const foreignCleanup = await runCli("cleanup.mjs", [], envFor(foreignDir));
check(
  "cleanup leaves another checkout's run alone",
  foreignCleanup.status === 0 &&
    foreignCleanup.stdout.includes("Leaving that server running") &&
    foreignSocket.connections.count === 0,
  output(foreignCleanup),
);
foreignSocket.close();

// Another next dev on a port is named by pid and cwd, never stopped.
const holderScript = path.join(scratch, "next");
const holderPortFile = path.join(scratch, "holder-port");
writeFileSync(
  holderScript,
  `const net = require("net");
const fs = require("fs");
const server = net.createServer();
server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(${JSON.stringify(holderPortFile)}, String(server.address().port));
});
setInterval(() => {}, 1000);
`,
);
const holder = track(
  spawn(process.execPath, [holderScript, "dev"], {
    cwd: otherCheckout,
    stdio: "ignore",
  }),
);
await waitUntil(() => existsSync(holderPortFile));
const holderPort = Number(readFileSync(holderPortFile, "utf8"));
const foreignNext = runtime.formatForeignNext(holderPort);
check(
  "foreign next listener",
  foreignNext.includes(`pid ${holder.pid}`) &&
    foreignNext.includes("another next dev") &&
    !foreignNext.includes(holderScript),
  foreignNext,
);

for (const { dir, state, child } of supervised) {
  if (state && child && child.exitCode === null && child.signalCode === null) {
    await runtime.stopRun(state, { dir });
  }
}
teardown();

// ---- Redaction --------------------------------------------------------------

// Every value is synthetic.
const leaked = [
  "SHARE_SIGNING_SECRET=abc123def456",
  'export VIRUSTOTAL_API_KEY="vt-key-value"',
  "redis https://default:hunter2pass@eu1.upstash.io/db",
  "Authorization: Bearer abcdefghijklmnop",
  "?url=x&token=tok_9f8e7d6c&sig=AbCdEf123",
  '"apiKey": "k-123456"',
  "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl",
  "bare Zk3Jq9XbT2mLw8RvN5cYp4Hs7Ag1Ed6U+/Qo==",
  "hex 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  '{"SHARE_SIGNING_SECRET_PREVIOUS": "synth-prev-one"}',
  '{"accessToken":"synth-camel-two","refreshToken": "synth-camel-three"}',
  "clientSecret=synth-camel-four",
  '"password": "synth-esc\\"aped-five tail"',
  '{\\"token\\": \\"synth-json-in-string-six\\"}',
  "?%74oken=synth-urlenc-seven&%73ecret=synth-urlenc-eight",
  "PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIsynthpemlinenine\n-----END PRIVATE KEY-----",
  "API_TOKEN=synth-multi-ten-a\\\n  synth-multi-ten-b",
  "token: |\n  synth-yaml-eleven\n  synth-yaml-twelve",
  "SECRET_VALUE=\n  synth-indented-thirteen",
  "Cookie: session=synth-cookie-fourteen; theme=dark",
  "run --auth-token synth-flag-fifteen",
  "x-api-key: synth-header-sixteen",
  "upstashRestToken = 'synth-single-seventeen'",
].join("\n");
const redacted = runtime.redactSecrets(leaked);
for (const secret of [
  "abc123def456",
  "vt-key-value",
  "hunter2pass",
  "abcdefghijklmnop",
  "tok_9f8e7d6c",
  "AbCdEf123",
  "k-123456",
  "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  "eyJhbGciOiJIUzI1NiJ9",
  "Zk3Jq9XbT2mLw8RvN5cYp4Hs7Ag1Ed6U",
  "9f86d081884c7d659a2feaa0c55ad015",
  "synth-prev-one",
  "synth-camel-two",
  "synth-camel-three",
  "synth-camel-four",
  "synth-esc",
  "aped-five",
  "synth-json-in-string-six",
  "synth-urlenc-seven",
  "synth-urlenc-eight",
  "MIIsynthpemlinenine",
  "synth-multi-ten-a",
  "synth-multi-ten-b",
  "synth-yaml-eleven",
  "synth-yaml-twelve",
  "synth-indented-thirteen",
  "synth-cookie-fourteen",
  "synth-flag-fifteen",
  "synth-header-sixteen",
  "synth-single-seventeen",
]) {
  check(
    `redacts ${secret.slice(0, 16)}…`,
    !redacted.includes(secret),
    redacted,
  );
}
const benign =
  "▲ Next.js 16.3.8\n- Local: http://127.0.0.1:3000\n- Network: http://127.0.0.1:3000\n✓ Ready in 1.2s\nGET / 200 in 85ms\nGET /about 200 in 12ms (compile: 3ms, render: 9ms)\n/Users/me/GitRepos/scrutinix2/t3-c2a46879/node_modules/next/dist/server/lib/start-server.js\nauthor: someone, signals: 8";
check(
  "redaction keeps ordinary log lines and paths",
  runtime.redactSecrets(benign) === benign,
  runtime.redactSecrets(benign),
);
const tailFile = path.join(scratch, "tail.log");
writeFileSync(
  tailFile,
  `${"x".repeat(5000)}\nUPSTASH_REDIS_REST_TOKEN=secret-token\n`,
);
const tail = runtime.logTail(tailFile);
check(
  "logTail is short and redacted",
  tail.length <= 4000 &&
    tail.includes("UPSTASH_REDIS_REST_TOKEN=[redacted]") &&
    !tail.includes("secret-token"),
  tail.slice(-80),
);
// Finding 6: a key and its value split by the cut. Slicing the last 4000
// characters first would start the excerpt with the bare value.
const boundarySecret = "SYNTH-boundary-secret-eighteen";
const afterKey = `${boundarySecret}"\n`;
const boundaryFile = path.join(scratch, "boundary.log");
writeFileSync(
  boundaryFile,
  `start\npassword="${afterKey}${"z".repeat(4000 - afterKey.length)}`,
);
const boundaryOneLine = path.join(scratch, "boundary-one-line.log");
writeFileSync(
  boundaryOneLine,
  `password="${boundarySecret}"${" pad".repeat(1000 - boundarySecret.length / 4)}`,
);
check(
  "logTail redacts before it cuts, so a split pair keeps its value hidden",
  !runtime.logTail(boundaryFile).includes(boundarySecret) &&
    !runtime.logTail(boundaryOneLine).includes(boundarySecret) &&
    runtime.logTail(boundaryFile).length <= 4000,
  runtime.logTail(boundaryFile).slice(0, 80),
);

// ---- Share key --------------------------------------------------------------

// launch must pass exactly the published key scripts/run-e2e.mjs passes:
// lib/config/env.ts accepts no other key in fixture mode.
const keyPattern = /"(e2e-only-share-signing-key-[^"]+)"/;
const e2eKey = readFileSync(
  path.join(runtime.repoRoot, "scripts/run-e2e.mjs"),
  "utf8",
).match(keyPattern)?.[1];
const launchKey = readFileSync(
  path.join(scriptDir, "launch.mjs"),
  "utf8",
).match(keyPattern)?.[1];
check(
  "launch uses the published e2e share key",
  Boolean(e2eKey) && launchKey === e2eKey,
  `${launchKey} vs ${e2eKey}`,
);

// ---- next-env.d.ts ----------------------------------------------------------

const declRoot = path.join(scratch, "decl");
mkdirSync(declRoot);
const decl = path.join(declRoot, "next-env.d.ts");
writeFileSync(decl, "user edit\n");
runtime.snapshotNextEnv(declRoot);
writeFileSync(decl, "next wrote this\n");
check("recorded written", runtime.recordNextEnvWritten(declRoot));
check(
  "next-env record is private",
  (lstatSync(path.join(stateDir, "next-env.json")).mode & 0o777) === 0o600,
);
const restored = runtime.restoreNextEnvSnapshot(declRoot);
check(
  "restore snapshot",
  restored.action === "restored" &&
    readFileSync(decl, "utf8") === "user edit\n",
  restored.warning,
);

writeFileSync(decl, "next wrote this\n");
runtime.snapshotNextEnv(declRoot);
runtime.recordNextEnvWritten(declRoot);
writeFileSync(decl, "edited after\n");
const left = runtime.restoreNextEnvSnapshot(declRoot);
const backupPath = left.warning.split("Snapshot saved to ")[1] ?? "";
check(
  "leave later edit",
  left.action === "left" &&
    readFileSync(decl, "utf8") === "edited after\n" &&
    left.warning.includes("Leaving it unchanged") &&
    backupPath.startsWith(evidenceDir) &&
    readFileSync(backupPath, "utf8") === "next wrote this\n",
  left.warning,
);

const gitRoot = path.join(scratch, "restart-repo");
mkdirSync(gitRoot);
const git = (args) =>
  spawnSync("git", args, { cwd: gitRoot, encoding: "utf8" });
git(["init"]);
git(["config", "user.email", "verify@example.com"]);
git(["config", "user.name", "verify"]);
const originalDeclaration = "committed original\n";
writeFileSync(path.join(gitRoot, "next-env.d.ts"), originalDeclaration);
git(["add", "next-env.d.ts"]);
const committed = git(["commit", "-m", "original"]);
check("restart repo committed", committed.status === 0, committed.stderr);
const firstSnap = runtime.snapshotNextEnv(gitRoot);
check(
  "restart first snapshot",
  firstSnap.kept !== true && firstSnap.snapshot === originalDeclaration,
);
writeFileSync(path.join(gitRoot, "next-env.d.ts"), "next wrote\n");
check("restart recorded write", runtime.recordNextEnvWritten(gitRoot));
const keptSnap = runtime.snapshotNextEnv(gitRoot);
check(
  "restart keeps snapshot",
  keptSnap.kept === true && keptSnap.snapshot === originalDeclaration,
  String(keptSnap.snapshot),
);
const restartRestore = runtime.restoreNextEnvSnapshot(gitRoot);
const restartStatus = git(["status", "--porcelain"]);
check(
  "restart git status clean",
  restartRestore.action === "restored" && restartStatus.stdout.trim() === "",
  restartStatus.stdout,
);
const consumed = runtime.snapshotNextEnv(gitRoot);
check(
  "cleanup consumed snapshot",
  consumed.kept !== true && consumed.snapshot === originalDeclaration,
  String(consumed.snapshot),
);
writeFileSync(path.join(gitRoot, "next-env.d.ts"), "rewritten again\n");
const dropped = runtime.snapshotNextEnv(gitRoot);
check(
  "drop snapshot when file matches neither",
  dropped.dropped === true &&
    dropped.kept !== true &&
    dropped.snapshot === "rewritten again\n" &&
    String(dropped.warning).includes("Dropping the old snapshot"),
  String(dropped.warning),
);
writeFileSync(path.join(gitRoot, "next-env.d.ts"), originalDeclaration);

const unfinishedDir = privateDir("unfinished");
writeFileSync(
  path.join(unfinishedDir, "next-env.json"),
  `${JSON.stringify({
    checkouts: {
      [checkout]: {
        missing: false,
        snapshot: "unfinished snapshot\n",
      },
    },
  })}\n`,
  { mode: 0o600 },
);
const unfinished = await runCli("cleanup.mjs", [], envFor(unfinishedDir));
const unfinishedBackup = (unfinished.stderr || "").split(
  "Snapshot saved to ",
)[1];
check(
  "cleanup drops unfinished snapshot without run.json",
  unfinished.status === 0 &&
    !existsSync(path.join(unfinishedDir, "next-env.json")) &&
    unfinished.stdout.includes("no run.json") &&
    typeof unfinishedBackup === "string" &&
    unfinishedBackup.includes("next-env-") &&
    readFileSync(unfinishedBackup.trim(), "utf8") === "unfinished snapshot\n",
  output(unfinished),
);

check(
  "next dev command",
  runtime.isNextDevCommand(
    "node /workspace/node_modules/.bin/next dev --port 3000",
  ),
);
check("next-server command", runtime.isNextDevCommand("next-server (v16.4.0)"));
check(
  "not a next command",
  !runtime.isNextDevCommand("node /tmp/runtime.check.mjs"),
);

const privacyShell = (heading, current) =>
  `<header><nav aria-label="Primary"><a href="/about">About</a><a ${current ? 'aria-current="page" ' : ""}href="/privacy" class="x">Privacy</a></nav></header><main id="main-content" class="mx-auto"><h1 class="text-xl">${heading}</h1></main>`;
check(
  "privacy anchor ignores heading copy",
  runtime.privacyPageRendered(
    privacyShell("History stays in the browser.", true),
  ) &&
    runtime.privacyPageRendered(
      privacyShell("What leaves this browser.", true),
    ),
);
check(
  "privacy anchor needs aria-current on the privacy link",
  !runtime.privacyPageRendered(privacyShell("Any heading", false)),
);
check(
  "privacy anchor needs the main shell",
  !runtime.privacyPageRendered(
    '<a aria-current="page" href="/privacy">Privacy</a><h1>404</h1>',
  ),
);

chmodSync(loose, 0o700);
rmSync(scratch, { recursive: true, force: true });

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("runtime.check passed\n");
