import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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

// Whether a child this check spawned has exited, read from its handle.
const exited = (child) => child.exitCode !== null || child.signalCode !== null;

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

// ---- Ports ------------------------------------------------------------------

// Finding 7 of round 3: every command takes --port <n>, never a URL, and
// refuses anything else without repeating it.
//
// These run against an inert state directory (mode 0755) that launch,
// cleanup, and doctor all refuse to use. If a guard here ever breaks, the
// command stops at that refusal with a different message, so the check fails
// instead of launching a server on a real port.
const inert = path.join(scratch, "inert");
mkdirSync(inert, { mode: 0o755 });
chmodSync(inert, 0o755);
const inertEnv = envFor(inert);
for (const script of ["launch.mjs", "doctor.mjs", "smoke.mjs"]) {
  for (const args of [
    ["--port", "not-a-port"],
    ["--port", ""],
    ["--port"],
    ["--port="],
    ["--port=80"],
    ["--port=65536"],
    ["--port=3000abc"],
    ["--port=+3000"],
    ["--port=3e3"],
    ["--port", " 3000"],
    ["--port=3420", "--port=3421"],
  ]) {
    const refused = await runCli(script, args, inertEnv);
    check(
      `${script} refuses ${JSON.stringify(args)}`,
      refused.status === 2 &&
        /--port (needs an integer|was given more than once)/.test(
          refused.stderr,
        ) &&
        !output(refused).includes("TypeError"),
      output(refused),
    );
  }
  // Errors never echo the input: it can carry credentials.
  for (const args of [
    ["--base-url", "http://user:SYNTH-cred-123@127.0.0.1:3000"],
    ["--base-url=http://user:SYNTH-cred-123@127.0.0.1:3000"],
    ["--port", "http://user:SYNTH-cred-123@127.0.0.1:3000"],
    ["--port=http://user:SYNTH-cred-123@127.0.0.1:3000"],
  ]) {
    const refused = await runCli(script, args, inertEnv);
    check(
      `${script} refuses ${args[0].slice(0, 10)} with credentials without echoing them`,
      refused.status === 2 &&
        !output(refused).includes("SYNTH-cred-123") &&
        !output(refused).includes("user:"),
      output(refused),
    );
  }
}
for (const script of ["launch.mjs", "doctor.mjs", "cleanup.mjs"]) {
  const unknown = await runCli(script, ["--token=SYNTH-arg-793"], inertEnv);
  check(
    `${script} refuses an argument it does not take without echoing it`,
    unknown.status === 2 && !output(unknown).includes("SYNTH-arg-793"),
    output(unknown),
  );
}
const parsedPort = runtime.parseCliArgs(["--json", "--port=3420"], {
  flags: ["--json"],
});
check(
  "--port=<n> and flags are parsed",
  parsedPort.ok && parsedPort.port === 3420 && parsedPort.flags.has("--json"),
  JSON.stringify(parsedPort),
);
const parsedRest = runtime.parseCliArgs(
  ["--drive", "-g", "batch scan", "--port", "3421"],
  { flags: ["--drive"], rest: true },
);
check(
  "smoke passes other arguments on to Playwright",
  parsedRest.ok &&
    parsedRest.port === 3421 &&
    parsedRest.flags.has("--drive") &&
    JSON.stringify(parsedRest.rest) === '["-g","batch scan"]',
  JSON.stringify(parsedRest),
);
const unusedPort = await freePort();
const fromEnv = await runCli("doctor.mjs", ["--port", String(unusedPort)], {
  ...inertEnv,
  E2E_BASE_URL: "http://u:SYNTH-env-792@127.0.0.1:3000",
});
check(
  "doctor ignores E2E_BASE_URL and probes 127.0.0.1:<port>",
  fromEnv.status === 2 &&
    fromEnv.stdout.includes("NOT_READY unreachable") &&
    !output(fromEnv).includes("SYNTH-env-792"),
  output(fromEnv),
);

// The real npm entry point. npm echoes a script's arguments in its banner
// and error footer unless it runs with --silent, which SKILL.md documents.
// The caller's own npm log level (npm --silent run verify:check exports
// npm_config_loglevel=silent) is dropped, so each call says its own.
function runNpm(args, env = process.env) {
  env = Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => key.toLowerCase() !== "npm_config_loglevel",
    ),
  );
  const npmCli = process.env.npm_execpath;
  const [command, prefix] =
    npmCli && /\.c?js$/.test(npmCli)
      ? [process.execPath, [npmCli]]
      : ["npm", []];
  return new Promise((resolve) => {
    const child = spawn(command, [...prefix, ...args], {
      cwd: runtime.repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", () => resolve({ status: null, stdout, stderr }));
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}
for (const [script, args] of [
  ["verify:doctor", ["--port", "http://u:SYNTH-npm-794@127.0.0.1:3139"]],
  ["verify:doctor", ["--port=http://u:SYNTH-npm-794@127.0.0.1:3139"]],
  ["verify:doctor", ["--base-url", "http://u:SYNTH-npm-794@127.0.0.1:3139"]],
  ["verify:launch", ["--base-url=http://u:SYNTH-npm-794@127.0.0.1:3139"]],
  ["verify:drive", ["--base-url=http://u:SYNTH-npm-794@127.0.0.1:3139"]],
]) {
  const viaNpm = await runNpm(
    ["--silent", "run", script, "--", ...args],
    inertEnv,
  );
  check(
    `npm --silent run ${script} refuses ${args[0].slice(0, 10)} and prints no credential`,
    viaNpm.status === 2 &&
      viaNpm.stderr.includes("--") &&
      !output(viaNpm).includes("SYNTH-npm-794") &&
      !output(viaNpm).includes("u:"),
    output(viaNpm),
  );
}
check(
  "no refused command wrote to the inert state directory",
  !existsSync(path.join(inert, "run.json")) &&
    !existsSync(path.join(inert, "evidence")),
);
const npmPlain = await runNpm(
  ["run", "verify:doctor", "--", "--port", String(unusedPort)],
  inertEnv,
);
check(
  "npm run verify:doctor -- --port <n> shows only the port in npm's banner",
  npmPlain.status !== 0 &&
    output(npmPlain).includes(`doctor.mjs --port ${unusedPort}`) &&
    npmPlain.stdout.includes("NOT_READY unreachable"),
  output(npmPlain),
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

// Finding 5 of round 3: the path is resolved component by component. A
// symlink of ours in a directory others can write is refused even though its
// target is safe, and so is a link whose target passes through one.
const swappable = path.join(scratch, "swappable");
mkdirSync(swappable);
chmodSync(swappable, 0o777);
const safeTarget = path.join(scratch, "safe-target");
mkdirSync(path.join(safeTarget, "state"), { recursive: true, mode: 0o700 });
mkdirSync(path.join(swappable, "real", "state"), {
  recursive: true,
  mode: 0o700,
});
symlinkSync("../safe-target", path.join(swappable, "link"));
symlinkSync(path.join(swappable, "real"), path.join(scratch, "via-swappable"));
symlinkSync("safe-target", path.join(scratch, "safe-link"));
const throughLink = path.join(swappable, "link", "state");
check(
  "reject a state dir reached through a symlink in a swappable directory",
  runtime.privateDirProblem(throughLink).includes(`${swappable} is writable`),
  runtime.privateDirProblem(throughLink),
);
check(
  "reject a state dir whose symlink target passes through a swappable directory",
  runtime
    .privateDirProblem(path.join(scratch, "via-swappable", "state"))
    .includes(`${swappable} is writable`),
  runtime.privateDirProblem(path.join(scratch, "via-swappable", "state")),
);
check(
  "accept a state dir reached through a symlink in a private directory",
  runtime.privateDirProblem(path.join(scratch, "safe-link", "state")) === "",
  runtime.privateDirProblem(path.join(scratch, "safe-link", "state")),
);
let createdUnderSwappable = true;
try {
  runtime.ensureDirs([path.join(swappable, "link", "fresh")]);
} catch (error) {
  createdUnderSwappable = !(error instanceof runtime.UnsafeStateError);
}
check(
  "nothing is created under a swappable path",
  !createdUnderSwappable && !existsSync(path.join(safeTarget, "fresh")),
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

// Every stand-in this check starts (fake apps, their grandchildren, and the
// strangers) holds a connection to this lifeline socket and exits when that
// connection closes. The check stops a stand-in by closing the end it holds,
// never by a saved pid or process group, and reads "exited" from the close
// the kernel delivers when the stand-in's process ends. If the check itself
// dies, every lifeline closes and every stand-in exits on its own.
const lifelinePath = path.join(scratch, "lifeline.sock");
const standIns = [];
const lifeline = net.createServer((socket) => {
  const entry = { name: "", role: "", pid: 0, socket, open: true };
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("error", () => {});
  socket.on("close", () => {
    entry.open = false;
  });
  socket.on("data", (chunk) => {
    buffer += chunk;
    for (let end; (end = buffer.indexOf("\n")) !== -1;) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let message = {};
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.listening) {
        entry.listening = true;
      } else if (!entry.name) {
        Object.assign(entry, {
          name: String(message.name),
          role: String(message.role),
          pid: Number(message.pid),
        });
        standIns.push(entry);
      }
    }
  });
});
await new Promise((resolve) => lifeline.listen(lifelinePath, resolve));

const standIn = (name, role) =>
  standIns.find((entry) => entry.name === name && entry.role === role);
const running = (entry) => Boolean(entry?.open);

// The stand-ins registered under `name`, once every role has connected.
async function standInsOf(name, roles, { listening = "" } = {}) {
  await waitUntil(
    () =>
      roles.every((role) => standIn(name, role)) &&
      (!listening || standIn(name, listening)?.listening),
  );
  return Object.fromEntries(
    roles.map((role) => [role, standIn(name, role) ?? { pid: 0, open: false }]),
  );
}

// Close the lifelines this check holds, and wait for those stand-ins to end.
async function release(entries) {
  for (const entry of entries) entry.socket.destroy();
  return waitUntil(() => entries.every((entry) => !running(entry)));
}

// Supervisors and direct children are stopped through their ChildProcess
// handles: kill is a no-op once the child is reaped, so the pid cannot be
// reused under it. Stand-ins are stopped by their lifelines. Also runs when
// the check itself is interrupted, so a killed run leaves nothing behind.
function teardown() {
  for (const { child } of supervised) child?.kill("SIGTERM");
  for (const child of children) child.kill("SIGTERM");
  for (const entry of standIns) entry.socket.destroy();
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

// A stand-in app. Mode "html" serves the three pages doctor reads, "silent"
// serves nothing, and "escape" starts a grandchild that leaves the process
// group (setsid) and serves the pages itself. Otherwise the grandchild stays
// in the group, so a stop is seen to reach the whole group.
const fakeApp = path.join(scratch, "fake-app.cjs");
writeFileSync(
  fakeApp,
  `const http = require("http");
const net = require("net");
const { spawn } = require("child_process");
const [port, mode, name, role = "app"] = process.argv.slice(2);
const pages = {
  "/": "<main>URL to analyze</main>",
  "/about": "<h1>How a scan becomes a verdict.</h1>",
  "/privacy": '<header><a aria-current="page" href="/privacy">Privacy</a></header><main id="main-content"><h1>Privacy</h1></main>',
};
// The check's lifeline: this process exits as soon as the check closes it.
const lifeline = net.connect(${JSON.stringify(lifelinePath)});
const say = (message) =>
  lifeline.write(JSON.stringify({ name, role, pid: process.pid, ...message }) + "\\n");
say({});
lifeline.once("close", () => process.exit(0));
lifeline.on("error", () => {});
function serve() {
  http
    .createServer((req, res) => {
      const body = pages[req.url];
      res.writeHead(body ? 200 : 404, { "content-type": "text/html" });
      res.end(body || "not found");
    })
    .listen(Number(port), "127.0.0.1", () => say({ listening: true }));
}
if (role === "app") {
  const escape = mode === "escape";
  spawn(
    process.execPath,
    [__filename, port, escape ? "html" : "idle", name, escape ? "escaped" : "grandchild"],
    { stdio: "ignore", detached: escape },
  );
  if (mode === "html") serve();
} else if (mode === "html") {
  serve();
}
setInterval(() => {}, 1000);
`,
);

// A server started by this check, not by any supervisor: same executable and
// same cwd (this checkout) as the app. The old design would have owned it.
async function stranger(port, name) {
  const child = track(
    spawn(process.execPath, [fakeApp, String(port), "html", name], {
      cwd: runtime.repoRoot,
      stdio: "ignore",
    }),
  );
  const pids = await standInsOf(name, ["app", "grandchild"], {
    listening: "app",
  });
  return { child, pids };
}

// Start a run as launch does. Takes the state lock unless the caller passes
// one it holds.
async function supervise(dir, port, mode, name, extra = {}) {
  const entry = { dir, state: null, child: null };
  supervised.push(entry);
  const lock = extra.lock ?? runtime.acquireStateLock("launch", dir);
  let started;
  try {
    started = await runtime.startSupervisor({
      command: process.execPath,
      args: [fakeApp, String(port), mode, name],
      env: process.env,
      port,
      dir,
      // Held from the moment of spawn, so an interrupted check still stops it.
      onSpawn: (child) => {
        entry.child = child;
      },
      ...extra,
      lock,
    });
  } finally {
    if (!extra.lock) runtime.releaseStateLock(lock);
  }
  entry.state = started.state;
  const second = mode === "escape" ? "escaped" : "grandchild";
  const pids = await standInsOf(name, ["app", second], {
    listening: mode === "html" ? "app" : mode === "escape" ? "escaped" : "",
  });
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
    !exited(victim),
  `${output(unsafeCleanup)}\nconnections ${unsafeSocket.connections.count}`,
);
unsafeSocket.close();

const symlinkSocket = await forgedSocket(symlinkedRun);
const symlinkCleanup = await runCli("cleanup.mjs", [], envFor(symlinkedRun));
check(
  "cleanup refuses a symlinked run.json and contacts nothing",
  symlinkCleanup.status === 2 &&
    symlinkSocket.connections.count === 0 &&
    !exited(victim),
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

const swapSocket = await forgedSocket(throughLink);
writeFileSync(path.join(throughLink, "run.json"), JSON.stringify(runRecord()), {
  mode: 0o600,
});
const swapCleanup = await runCli("cleanup.mjs", [], envFor(throughLink));
check(
  "cleanup refuses a state dir reached through a swappable symlink",
  swapCleanup.status === 2 &&
    swapCleanup.stderr.includes("not sticky") &&
    swapSocket.connections.count === 0,
  `${output(swapCleanup)}\nconnections ${swapSocket.connections.count}`,
);
swapSocket.close();

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
    !exited(victim),
  `${output(forgedCleanup)}\nconnections ${forged.connections.count}`,
);
const forgedDoctor = await runtime.runOwnership(3000, {
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
    !exited(victim),
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
    runtime.processGroup(run.pids.app.pid) === supervisorPid &&
    runtime.processGroup(run.pids.grandchild.pid) === supervisorPid,
  JSON.stringify({ supervisorPid, app: run.pids.app.pid }),
);
check(
  "status names the app's listener on 127.0.0.1 as its own",
  status?.listeners.own.some(
    (listener) =>
      listener.pid === run.pids.app.pid && listener.address === "127.0.0.1",
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
  runtime.processGroup(strangerB.pids.app.pid) !== supervisorPid,
);

const doctorOwn = await runCli(
  "doctor.mjs",
  ["--port", String(portA)],
  envFor(runDir),
);
check(
  "doctor is READY and owned on the run's own port",
  doctorOwn.status === 0 &&
    doctorOwn.stdout.includes("doctor: READY") &&
    doctorOwn.stdout.includes(`owned by run ${run.state.runId}`),
  output(doctorOwn),
);
// Finding 3 of round 3: smoke and drive capture Playwright's output. A
// stand-in Playwright prints a canary to stdout and stderr and reports one
// failing test; smoke prints the counts, the failing title, and the log path,
// and the canary reaches only the 0600 log.
const fakePlaywright = path.join(scratch, "fake-playwright.cjs");
writeFileSync(
  fakePlaywright,
  `const fs = require("fs");
const canary = "SYNTH-pw-canary-28";
process.stdout.write("  x 1 drive > shares a signed link\\n    accessToken=" + canary + "\\n");
process.stderr.write("Authorization: Bearer " + canary + "\\n" + JSON.stringify({ token: canary }) + "\\n");
fs.writeFileSync(process.env.VERIFY_REPORT_FILE, JSON.stringify({
  suites: [{ title: "drive.spec.ts", specs: [], suites: [{ title: "drive", specs: [
    { title: "opens the home page", ok: true },
    { title: "shares a signed link", ok: false, tests: [{ results: [{ error: { message: "token=" + canary } }] }] },
  ] }] }],
  errors: [],
  stats: { expected: 1, unexpected: 1, flaky: 0, skipped: 0 },
}));
process.exit(1);
`,
);
const driveRun = await runCli(
  "smoke.mjs",
  ["--drive", "--port", String(portA), "-g", "signed"],
  envFor(runDir, { VERIFY_PLAYWRIGHT_CLI: fakePlaywright }),
);
const driveLog = path.join(runDir, "drive.log");
check(
  "drive prints a summary, never Playwright's output",
  driveRun.status === 1 &&
    !output(driveRun).includes("SYNTH-pw-canary-28") &&
    driveRun.stdout.includes("doctor: READY") &&
    driveRun.stderr.includes(
      "drive: Playwright exited 1: 1 passed, 1 failed, 0 flaky, 0 skipped",
    ) &&
    driveRun.stderr.includes(
      "drive: failed: drive.spec.ts › drive › shares a signed link",
    ) &&
    driveRun.stderr.includes(`drive: log ${driveLog}`),
  output(driveRun),
);
check(
  "Playwright's output is kept in a 0600 log",
  existsSync(driveLog) &&
    (lstatSync(driveLog).mode & 0o777) === 0o600 &&
    readFileSync(driveLog, "utf8").includes("accessToken=SYNTH-pw-canary-28"),
);

const doctorForeign = await runCli(
  "doctor.mjs",
  ["--port", String(portB), "--json"],
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
const wrongToken = await runtime.supervisorRequest(
  { ...run.state, token: token("b") },
  "stop",
  { dir: runDir },
);
await delay(300);
check(
  "a stop without the run token is refused and stops nothing",
  wrongToken.proven === false &&
    running(run.pids.app) &&
    running(run.pids.grandchild) &&
    !exited(run.child),
  JSON.stringify(wrongToken),
);

const runCleanup = await runCli("cleanup.mjs", [], envFor(runDir));
await waitUntil(
  () =>
    !running(run.pids.app) &&
    !running(run.pids.grandchild) &&
    exited(run.child),
);
check(
  "cleanup stops the app, its grandchild, and the supervisor",
  runCleanup.status === 0 &&
    runCleanup.stdout.includes(`stopped run ${run.state.runId}`) &&
    !running(run.pids.app) &&
    !running(run.pids.grandchild) &&
    exited(run.child),
  output(runCleanup),
);
check(
  "cleanup leaves a same-checkout server, its child, and an outside process running",
  running(strangerB.pids.app) &&
    running(strangerB.pids.grandchild) &&
    !exited(outsider) &&
    !exited(victim),
);
check(
  "the run's port is free and its socket, token, and lock are gone",
  !(await runtime.tcpOpen(portA)) &&
    !existsSync(runtime.socketPath(runDir)) &&
    !existsSync(runtime.lockPath(runDir)) &&
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
const takenOwnership = await runtime.runOwnership(portC, {
  dir: takenDir,
});
check(
  "a same-checkout listener that is not in the run's group is not owned",
  takenOwnership.owned === false &&
    takenOwnership.reason.includes("outside this run") &&
    takenOwnership.body?.listeners.foreign.some(
      (listener) => listener.pid === strangerC.pids.app.pid,
    ),
  JSON.stringify(takenOwnership),
);
const takenDoctor = await runCli(
  "doctor.mjs",
  ["--port", String(portC)],
  envFor(takenDir),
);
check(
  "doctor is not READY when a stranger holds the run's port",
  takenDoctor.status === 2 && takenDoctor.stdout.includes("foreign-server"),
  output(takenDoctor),
);
const takenCleanup = await runCli("cleanup.mjs", [], envFor(takenDir));
await waitUntil(() => !running(taken.pids.app));
check(
  "cleanup stops only the run's app and reports the stranger on the port",
  takenCleanup.status === 1 &&
    !running(taken.pids.app) &&
    exited(taken.child) &&
    running(strangerC.pids.app) &&
    takenCleanup.stderr.includes("cleanup is incomplete") &&
    takenCleanup.stderr.includes(
      `port ${portC} still answers (pid ${strangerC.pids.app.pid}, started`,
    ),
  output(takenCleanup),
);

// Finding 4: when the supervisor is gone, nothing is re-found by identity.
// The orphaned app keeps running and is reported. The check then ends the
// orphans through their lifelines: their group has no living leader, so its
// id no longer names only them.
const portD = await freePort();
const orphanDir = privateDir("orphan");
const orphan = await supervise(orphanDir, portD, "html", "app-d");
orphan.child.kill("SIGKILL");
await waitUntil(() => exited(orphan.child));
const orphanCleanup = await runCli("cleanup.mjs", [], envFor(orphanDir));
check(
  "cleanup never signals a pid itself when the supervisor is gone",
  orphanCleanup.status === 1 &&
    orphanCleanup.stdout.includes("already gone") &&
    orphanCleanup.stderr.includes(`port ${portD} is still open`) &&
    running(orphan.pids.app) &&
    running(orphan.pids.grandchild),
  output(orphanCleanup),
);
check(
  "the orphans exit when the check closes their lifelines",
  (await release([orphan.pids.app, orphan.pids.grandchild])) &&
    !(await runtime.tcpOpen(portD)),
);

// Finding 6 of round 3: a grandchild that leaves the run's process group
// (setsid) is not stopped, and is not looked for. It still holds the port,
// so cleanup reports the stop as incomplete, names the listener, exits 1, and
// leaves it running. The check then ends it through its lifeline.
const portF = await freePort();
const escapeDir = privateDir("escape");
const escape = await supervise(escapeDir, portF, "escape", "app-f");
check(
  "an escaped grandchild leads its own group, outside the run's",
  runtime.processGroup(escape.pids.escaped.pid) === escape.pids.escaped.pid &&
    runtime.processGroup(escape.pids.app.pid) === escape.state.supervisorPid,
);
const escapeCleanup = await runCli("cleanup.mjs", [], envFor(escapeDir));
await waitUntil(() => exited(escape.child));
check(
  "cleanup reports an escaped grandchild on the port as incomplete and leaves it running",
  escapeCleanup.status === 1 &&
    escapeCleanup.stderr.includes("cleanup is incomplete") &&
    escapeCleanup.stderr.includes(
      `port ${portF} still answers (pid ${escape.pids.escaped.pid}, started`,
    ) &&
    !escapeCleanup.stdout.includes(`stopped run`) &&
    exited(escape.child) &&
    !running(escape.pids.app) &&
    running(escape.pids.escaped),
  output(escapeCleanup),
);
check(
  "the escaped grandchild exits through its lifeline and the port frees",
  (await release([escape.pids.escaped])) && !(await runtime.tcpOpen(portF)),
);

// A supervisor that proves the token and says it stopped, yet keeps
// answering on the socket, is reported too, and its token is kept.
const lingerDir = privateDir("linger");
const lingerPort = await freePort();
const lingerState = runRecord({
  port: lingerPort,
  baseUrl: `http://127.0.0.1:${lingerPort}`,
});
writeFileSync(path.join(lingerDir, "run.json"), JSON.stringify(lingerState), {
  mode: 0o600,
});
const lingering = net.createServer((connection) => {
  connection.setEncoding("utf8");
  connection.on("error", () => {});
  connection.once("data", (line) => {
    let nonce = "";
    try {
      nonce = String(JSON.parse(line).nonce);
    } catch {
      nonce = "";
    }
    const body = {
      ok: true,
      runId: lingerState.runId,
      supervisorPid: 1,
      stopped: true,
      leftover: 0,
    };
    connection.end(
      `${JSON.stringify({ body, proof: runtime.serverProof(lingerState.token, nonce, body) })}\n`,
    );
  });
});
await new Promise((resolve) =>
  lingering.listen(runtime.socketPath(lingerDir), resolve),
);
const lingerCleanup = await runCli("cleanup.mjs", [], envFor(lingerDir));
check(
  "cleanup reports a socket that still answers after a stop, and keeps the token",
  lingerCleanup.status === 1 &&
    lingerCleanup.stderr.includes("cleanup is incomplete") &&
    lingerCleanup.stderr.includes("supervisor.sock still answers") &&
    runtime.readState(lingerDir)?.token === lingerState.token,
  output(lingerCleanup),
);
lingering.close();

// Finding 4 of round 3: two launches race for one state directory. Both
// start before either supervisor listens, so without the lock both would
// write run.json and spawn. With it, exactly one does; the other refuses
// before writing anything, and the recorded token is the live run's.
const raceDir = privateDir("race");
const racePort = await freePort();
const raceSpawns = () =>
  supervised.filter((entry) => entry.dir === raceDir && entry.child).length;
const raceLaunch = async (name) => {
  const lock = runtime.acquireStateLock("launch", raceDir);
  try {
    return await supervise(raceDir, racePort, "html", name, {
      lock,
      lingerMs: 1_000,
    });
  } finally {
    runtime.releaseStateLock(lock);
  }
};
const race = await Promise.allSettled([
  raceLaunch("race-a"),
  raceLaunch("race-b"),
]);
const raceWinner = race.find((result) => result.status === "fulfilled")?.value;
const raceLoser = race.find((result) => result.status === "rejected")?.reason;
const raceState = runtime.readState(raceDir);
const raceStatus = raceState
  ? await runtime.supervisorRequest(raceState, "status", { dir: raceDir })
  : { proven: false };
check(
  "concurrent launches: one starts, the other refuses on the lock and writes nothing",
  raceSpawns() === 1 &&
    Boolean(raceWinner?.status) &&
    raceLoser instanceof runtime.StateLockedError &&
    raceLoser.message.includes("is held by launch") &&
    raceState?.runId === raceWinner?.state.runId &&
    raceStatus.proven === true &&
    !existsSync(runtime.lockPath(raceDir)),
  JSON.stringify({
    spawns: raceSpawns(),
    loser: String(raceLoser?.message ?? "none"),
    proven: raceStatus.proven,
  }),
);
if (raceState?.token) await runtime.stopRun(raceState, { dir: raceDir });

// A lock left behind is never taken over: launch and cleanup refuse, contact
// nothing, and leave the lock as it was. Each directory holds a forged socket
// and a run.json pointing at it, so a broken lock check would only reach that
// harmless socket (and fail here), never start or stop anything.
for (const script of ["launch.mjs", "cleanup.mjs"]) {
  const staleDir = privateDir(`stale-${script.split(".")[0]}`);
  const staleLock = JSON.stringify({
    nonce: "f".repeat(32),
    command: "launch",
    pid: 1,
    since: "2026-01-01T00:00:00.000Z",
  });
  writeFileSync(runtime.lockPath(staleDir), staleLock, { mode: 0o600 });
  writeFileSync(path.join(staleDir, "run.json"), JSON.stringify(runRecord()), {
    mode: 0o600,
  });
  const staleSocket = await forgedSocket(staleDir);
  const refused = await runCli(
    script,
    ["--port", String(await freePort())].slice(script === "launch.mjs" ? 0 : 2),
    envFor(staleDir, { VERIFY_SKIP_BROWSER_INSTALL: "1" }),
  );
  check(
    `${script} refuses a held lock, never takes it over, and contacts nothing`,
    refused.status === 2 &&
      refused.stderr.includes("is held by launch (pid 1, since 2026-01-01") &&
      refused.stderr.includes("never taken over") &&
      staleSocket.connections.count === 0 &&
      readFileSync(runtime.lockPath(staleDir), "utf8") === staleLock &&
      runtime.readState(staleDir)?.runId === "abcdef012345",
    `${output(refused)}\nconnections ${staleSocket.connections.count}`,
  );
  staleSocket.close();
}
let lockless = "";
try {
  await runtime.startSupervisor({
    command: process.execPath,
    args: ["-e", ""],
    port: await freePort(),
    dir: privateDir("lockless"),
    // Were the guard ever to break, this run would end itself in a second
    // and teardown holds its handle.
    lingerMs: 1_000,
    onSpawn: (child) => children.push(child),
  });
} catch (error) {
  lockless = error instanceof Error ? error.message : String(error);
}
check(
  "startSupervisor refuses to write run.json without the lock",
  lockless.includes("needs the lock") &&
    !existsSync(path.join(scratch, "lockless", "run.json")),
  lockless,
);

// `kill <supervisor pid>` is the manual stop: the group goes with it.
const portE = await freePort();
const signalDir = privateDir("signal");
const signalled = await supervise(signalDir, portE, "html", "app-e");
signalled.child.kill("SIGTERM");
await waitUntil(
  () =>
    exited(signalled.child) &&
    !running(signalled.pids.app) &&
    !running(signalled.pids.grandchild),
);
check(
  "SIGTERM to the supervisor stops its group and removes its socket",
  exited(signalled.child) &&
    !running(signalled.pids.app) &&
    !running(signalled.pids.grandchild) &&
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
  if (state && child && !exited(child)) await runtime.stopRun(state, { dir });
}
teardown();
check(
  "every stand-in this check started has exited",
  (await release(standIns)) && standIns.length > 0,
  standIns
    .filter(running)
    .map((entry) => `${entry.name}/${entry.role}`)
    .join(", "),
);
lifeline.close();
// Finding 1 of round 3: the check never signals a process group it saved.
check(
  "the check signals no process group",
  !/process\.kill\(\s*-/.test(
    readFileSync(fileURLToPath(import.meta.url), "utf8"),
  ),
);

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
  // Finding 2 of round 3, alone on a line and embedded in a longer one
  '{"token":"synth-json-eighteen"}',
  '{"tokens":["synth-first-nineteen","synth-array-twenty"]}',
  '{"apiKey":\n"synth-newline-twentyone"}',
  String.raw`{"msg":"https:\/\/default:synth-escaped-url-22@registry.example.invalid/pkg"}`,
  'npm error {"tokens":["a","synth-embedded-23"], "x":1}',
  String.raw`warn {"msg":"https:\/\/default:synth-embedded-url-24@r.example.invalid"} end`,
  'x {"secret": {"v": "synth-object-25"}} y',
  String.raw`{"msg":"{\"token\":\"synth-nested-26\"}"}`,
  '  "credentials": {\n    "user": "u",\n    "value": "synth-pretty-27"\n  }',
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
  "synth-json-eighteen",
  "synth-first-nineteen",
  "synth-array-twenty",
  "synth-newline-twentyone",
  "synth-escaped-url-22",
  "synth-embedded-23",
  "synth-embedded-url-24",
  "synth-object-25",
  "synth-nested-26",
  "synth-pretty-27",
]) {
  check(
    `redacts ${secret.slice(0, 16)}…`,
    !redacted.includes(secret),
    redacted,
  );
}
// The reviewer's four inputs, each as the whole text.
for (const [label, text] of [
  ["a JSON token", '{"token":"SYNTH-r3-canary"}'],
  ["a JSON token array", '{"tokens":["first","SYNTH-r3-canary"]}'],
  ["a value on the next line", '{"apiKey":\n"SYNTH-r3-canary"}'],
  [
    "an escaped URL credential",
    String.raw`{"msg":"https:\/\/default:SYNTH-r3-canary@registry.example.invalid/pkg"}`,
  ],
]) {
  check(
    `redacts ${label} on its own`,
    !runtime.redactSecrets(text).includes("SYNTH-r3-canary"),
    runtime.redactSecrets(text),
  );
}
check(
  "JSON redaction keeps non-secret fields",
  runtime.redactSecrets('{"status":"ok","count":3,"token":"x1"}') ===
    '{"status":"ok","count":3,"token":"[redacted]"}',
  runtime.redactSecrets('{"status":"ok","count":3,"token":"x1"}'),
);
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

// launch's npm ci and browser install go through runCommand: the child's
// output lands in the log, and nothing reaches the caller's stdout or stderr.
const captureDir = privateDir("capture");
const capture = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `const runtime = await import(${JSON.stringify(new URL("./runtime.mjs", import.meta.url).href)});
const result = runtime.runCommand(process.execPath, ["-e", "console.log('accessToken=SYNTH-cmd-29'); console.error('Bearer SYNTH-cmd-29xyz')"], { logFile: runtime.logPath("install.log") });
process.stdout.write(runtime.exitSummary(result));`,
  ],
  { env: envFor(captureDir), encoding: "utf8" },
);
const captureLog = path.join(captureDir, "install.log");
check(
  "runCommand keeps a child's output in its 0600 log",
  capture.status === 0 &&
    capture.stdout === "exited 0" &&
    !`${capture.stdout}${capture.stderr}`.includes("SYNTH-cmd-29") &&
    (lstatSync(captureLog).mode & 0o777) === 0o600 &&
    readFileSync(captureLog, "utf8").includes("accessToken=SYNTH-cmd-29"),
  `${capture.status}\n${capture.stdout}\n${capture.stderr}`,
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

// A supervisor still answering in the scratch directory is a run this check
// did not stop. Keep the directory, so its run.json still reaches it.
function answers(file) {
  return new Promise((resolve) => {
    const socket = net.createConnection(file);
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
const leftRuns = [];
for (const name of readdirSync(scratch)) {
  const file = runtime.socketPath(path.join(scratch, name));
  if (existsSync(file) && (await answers(file))) leftRuns.push(name);
}
check(
  "no supervisor is left answering in the scratch directory",
  leftRuns.length === 0,
  `${leftRuns.join(", ")}: stop with VERIFY_STATE_DIR=${scratch}/<dir> npm run verify:cleanup`,
);
chmodSync(loose, 0o700);
if (!leftRuns.length) rmSync(scratch, { recursive: true, force: true });

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("runtime.check passed\n");
