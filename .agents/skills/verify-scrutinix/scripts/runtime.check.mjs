import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
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
// Every line a check would print if it failed, kept for the final scan.
const checkLines = [];

// Finding 4 of round 4: a check's failure detail is a few selected fields.
// Numbers, booleans, and null print as they are; any other value (a string,
// an array, an object) prints only as its kind and size. So captured
// subprocess output, run.json, and run tokens never reach the terminal or a
// CI log, whatever a caller passes.
function printable(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return String(value);
  }
  if (typeof value === "string") return `<string, ${value.length} chars>`;
  if (Array.isArray(value)) return `<array, ${value.length} items>`;
  return `<${typeof value}>`;
}

function formatDetail(fields) {
  if (fields === undefined) return "";
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return `detail=${printable(fields)}`;
  }
  return Object.entries(fields)
    .map(
      ([key, value]) =>
        `${/^[A-Za-z]\w{0,39}$/.test(key) ? key : "?"}=${printable(value)}`,
    )
    .join(" ");
}

function check(name, ok, fields) {
  const detail = formatDetail(fields);
  const line = detail ? `${name}: ${detail}` : name;
  checkLines.push(line);
  if (ok) {
    process.stdout.write(`ok ${name}\n`);
    return;
  }
  failures.push(line);
  process.stdout.write(`not ok ${line}\n`);
}

function assertPrivate(dir) {
  const stat = lstatSync(dir);
  const mode = stat.mode & 0o777;
  check(`${dir} mode 0700`, mode === 0o700, { mode: Number(mode.toString(8)) });
  check(`${path.basename(dir)} owner`, stat.uid === process.getuid(), {
    uid: stat.uid,
  });
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
      [
        path.isAbsolute(script) ? script : path.join(scriptDir, script),
        ...args,
      ],
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

// A CLI result's whole text, for assertions only. A check's detail takes
// cli(result), the exit status, never the text.
const output = (result) =>
  `${result.status}\n${result.stdout}\n${result.stderr}`;
const cli = (result) => ({ status: result.status });

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
      cli(refused),
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
      cli(refused),
    );
  }
}
for (const script of ["launch.mjs", "doctor.mjs", "cleanup.mjs"]) {
  const unknown = await runCli(script, ["--token=SYNTH-arg-793"], inertEnv);
  check(
    `${script} refuses an argument it does not take without echoing it`,
    unknown.status === 2 && !output(unknown).includes("SYNTH-arg-793"),
    cli(unknown),
  );
}
const parsedPort = runtime.parseCliArgs(["--json", "--port=3420"], {
  flags: ["--json"],
});
check(
  "--port=<n> and flags are parsed",
  parsedPort.ok && parsedPort.port === 3420 && parsedPort.flags.has("--json"),
  { ok: parsedPort.ok, port: parsedPort.port ?? null },
);
const parsedRest = runtime.parseCliArgs(
  ["--drive", "-g", "batch scan", "--port", "3421"],
  { flags: ["--drive"], rest: true },
);
check(
  "smoke hands its other arguments to suite.mjs, which allows only a title filter",
  parsedRest.ok &&
    parsedRest.port === 3421 &&
    parsedRest.flags.has("--drive") &&
    JSON.stringify(parsedRest.rest) === '["-g","batch scan"]',
  {
    ok: parsedRest.ok,
    port: parsedRest.port ?? null,
    rest: parsedRest.rest?.length ?? null,
  },
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
  cli(fromEnv),
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
    cli(viaNpm),
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
  cli(npmPlain),
);
const hint = runtime.foreignNextStopHint(3000);
check(
  "stop hint names exact-pid checks and never a command line",
  hint.includes("lsof -nP -iTCP:3000") &&
    hint.includes("lstart") &&
    hint.includes("kill <pid>") &&
    !hint.includes("cmdline") &&
    hint.includes("Do not kill by name"),
  { length: hint.length },
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
);

const loose = path.join(scratch, "loose");
mkdirSync(loose);
chmodSync(loose, 0o777);
const underLoose = path.join(loose, "st");
mkdirSync(underLoose, { mode: 0o700 });
check(
  "reject a state dir under a group-writable, non-sticky directory",
  runtime.privateDirProblem(underLoose).includes("not sticky"),
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
);
check(
  "reject a state dir whose symlink target passes through a swappable directory",
  runtime
    .privateDirProblem(path.join(scratch, "via-swappable", "state"))
    .includes(`${swappable} is writable`),
);
check(
  "accept a state dir reached through a symlink in a private directory",
  runtime.privateDirProblem(path.join(scratch, "safe-link", "state")) === "",
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
);
const writableRun = privateDir("writable-run");
writeFileSync(path.join(writableRun, "run.json"), JSON.stringify(runRecord()));
chmodSync(path.join(writableRun, "run.json"), 0o666);
check(
  "reject a run.json others can write",
  runtime
    .loadState(writableRun)
    .problem.includes("writable by group or others"),
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
// A check that throws ends the same way: teardown is synchronous (handle
// kills and lifeline closes), so it runs on exit too.
process.on("exit", teardown);

// A process that only waits, in `cwd`. Like every stand-in it holds a
// lifeline (finding 6 of round 4): it exits when the check closes it, or
// when the check dies, so a SIGKILLed check leaves no sleeper behind.
async function sleeper(cwd, name) {
  const child = track(
    spawn(process.execPath, [fakeApp, "0", "idle", name, "sleeper"], {
      cwd,
      stdio: "ignore",
    }),
  );
  await standInsOf(name, ["sleeper"]);
  return child;
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
      // If the check is SIGKILLed, the app exits on its lifeline, and the
      // supervisor goes 10 seconds later rather than launch's 2 minutes.
      lingerMs: 10_000,
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
  { pid: self?.pid ?? null },
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
  { listeners: runtime.portListeners(probePort).length },
);
const details = runtime.portDetails(probePort);
check(
  "port details are identity fields, not a command line",
  details.includes(`pid ${process.pid}, started `) &&
    !details.includes("runtime.check.mjs"),
  { length: details.length },
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

const victim = await sleeper(runtime.repoRoot, "victim");
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
  { ...cli(unsafeCleanup), connections: unsafeSocket.connections.count },
);
unsafeSocket.close();

const symlinkSocket = await forgedSocket(symlinkedRun);
const symlinkCleanup = await runCli("cleanup.mjs", [], envFor(symlinkedRun));
check(
  "cleanup refuses a symlinked run.json and contacts nothing",
  symlinkCleanup.status === 2 &&
    symlinkSocket.connections.count === 0 &&
    !exited(victim),
  { ...cli(symlinkCleanup), connections: symlinkSocket.connections.count },
);
symlinkSocket.close();

writeFileSync(path.join(underLoose, "run.json"), JSON.stringify(runRecord()), {
  mode: 0o600,
});
const looseCleanup = await runCli("cleanup.mjs", [], envFor(underLoose));
check(
  "cleanup refuses a state dir under a swappable parent",
  looseCleanup.status === 2 && looseCleanup.stderr.includes("not sticky"),
  cli(looseCleanup),
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
  { ...cli(swapCleanup), connections: swapSocket.connections.count },
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
    forgedCleanup.stderr.includes("Never signal a pid read from run.json") &&
    !exited(victim),
  { ...cli(forgedCleanup), connections: forged.connections.count },
);
const forgedDoctor = await runtime.runOwnership(3000, {
  dir: forgedDir,
});
check(
  "a forged supervisor never makes doctor report owned",
  forgedDoctor.owned === false && forgedDoctor.reason.includes("did not prove"),
  { owned: forgedDoctor.owned },
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
  cli(legacyCleanup),
);

// ---- Findings 2 to 4: a run stops its own process group, nothing else --------

const portA = await freePort();
const portB = await freePort();
const strangerB = await stranger(portB, "stranger-b");
const outsider = await sleeper("/tmp", "outsider");
const runDir = privateDir("run");
const run = await supervise(runDir, portA, "html", "app-a");
check("supervisor answers at start", Boolean(run.status), {
  answered: Boolean(run.status),
});
const status = (
  await runtime.supervisorRequest(run.state, "status", { dir: runDir })
).body;
const supervisorPid = run.state.supervisorPid;
check(
  "supervisor leads its own process group, with the app and grandchild in it",
  runtime.processGroup(supervisorPid) === supervisorPid &&
    runtime.processGroup(run.pids.app.pid) === supervisorPid &&
    runtime.processGroup(run.pids.grandchild.pid) === supervisorPid,
  { supervisorPid, app: run.pids.app.pid },
);
check(
  "status names the app's listener on 127.0.0.1 as its own",
  status?.listeners.own.some(
    (listener) =>
      listener.pid === run.pids.app.pid && listener.address === "127.0.0.1",
  ) && status.listeners.foreign.length === 0,
  {
    own: status?.listeners.own.length ?? null,
    foreign: status?.listeners.foreign.length ?? null,
  },
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
  cli(doctorOwn),
);
// Finding 3 of round 3: smoke and drive capture Playwright's output. A
// stand-in Playwright prints a canary to stdout and stderr and reports one
// failing test; smoke prints the counts, the failing title, and the log path,
// and the canary reaches only the 0600 log.
//
// Finding 5 of round 4: the stand-in reaches runSuite only as the argument
// this check passes. smoke.mjs, the npm entry point, always runs the real
// Playwright CLI.
const suiteModule = new URL("./suite.mjs", import.meta.url).href;
function runSuiteWith(cli, argv, env) {
  return runCli(
    path.join(scratch, "run-suite.mjs"),
    [suiteModule, cli, JSON.stringify(argv)],
    env,
  );
}
writeFileSync(
  path.join(scratch, "run-suite.mjs"),
  `const [suite, cli, argv] = process.argv.slice(2);
const { runSuite } = await import(suite);
process.exit(runSuite(JSON.parse(argv), cli));
`,
);
const standInPlaywright = (name, body) => {
  const file = path.join(scratch, `${name}.cjs`);
  writeFileSync(file, `const fs = require("fs");\n${body}`);
  return file;
};
const fakePlaywright = standInPlaywright(
  "fake-playwright",
  `const canary = "SYNTH-pw-canary-28";
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
const driveRun = await runSuiteWith(
  fakePlaywright,
  ["--drive", "--port", String(portA), "-g", "signed"],
  envFor(runDir),
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
  cli(driveRun),
);
check(
  "Playwright's output is kept in a 0600 log",
  existsSync(driveLog) &&
    (lstatSync(driveLog).mode & 0o777) === 0o600 &&
    readFileSync(driveLog, "utf8").includes("accessToken=SYNTH-pw-canary-28"),
);

// A Playwright that exits 0 without a report, or with a report in which no
// test ran, verified nothing: smoke fails.
const silentPlaywright = standInPlaywright(
  "silent-playwright",
  "process.exit(0);\n",
);
const emptyPlaywright = standInPlaywright(
  "empty-playwright",
  `fs.writeFileSync(process.env.VERIFY_REPORT_FILE, JSON.stringify({ suites: [], errors: [], stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 1 } }));
process.exit(0);
`,
);
for (const [label, runner, message] of [
  [
    "no report",
    silentPlaywright,
    "smoke: Playwright exited 0 and wrote no report, so nothing was verified",
  ],
  [
    "a report with no test run",
    emptyPlaywright,
    "smoke: no test ran, so nothing was verified",
  ],
]) {
  const empty = await runSuiteWith(
    runner,
    ["--port", String(portA)],
    envFor(runDir),
  );
  check(
    `smoke fails when Playwright exits 0 with ${label}`,
    empty.status === 1 && empty.stderr.includes(message),
    cli(empty),
  );
}

// Round 5: only a title filter reaches Playwright. Another --config, a spec
// path, or a reporter would run or write something other than this skill's
// suite (and print that suite's titles as this one's), so smoke refuses
// them before Playwright starts, without echoing them. Inherited
// PLAYWRIGHT_*/PW_* variables, which Playwright reads ahead of the config,
// never reach it, and the HTML report never opens.
const recorded = path.join(scratch, "recorded-playwright.json");
const recordingPlaywright = standInPlaywright(
  "recording-playwright",
  `fs.writeFileSync(${JSON.stringify(recorded)}, JSON.stringify({
  argv: process.argv.slice(2),
  playwrightEnv: Object.keys(process.env).filter((key) => /^(PLAYWRIGHT_|PW_)/.test(key)),
  htmlOpen: process.env.PLAYWRIGHT_HTML_OPEN,
}));
fs.writeFileSync(process.env.VERIFY_REPORT_FILE, JSON.stringify({ suites: [], errors: [], stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 } }));
process.exit(0);
`,
);
for (const [label, extra] of [
  [
    "another config",
    ["--config", path.join(scratch, "SYNTH-other.config.mjs")],
  ],
  ["a spec path", [path.join(scratch, "SYNTH-other.spec.ts")]],
  ["a reporter", ["--reporter=line"]],
  ["an output directory", ["--output", path.join(scratch, "SYNTH-out")]],
  ["a filter that is really an option", ["-g", "--config"]],
]) {
  rmSync(recorded, { force: true });
  const refused = await runSuiteWith(
    recordingPlaywright,
    ["--port", String(portA), ...extra],
    envFor(runDir),
  );
  check(
    `smoke refuses ${label} before Playwright starts, without echoing it`,
    refused.status === 2 &&
      !existsSync(recorded) &&
      !output(refused).includes("SYNTH-") &&
      !output(refused).includes("--reporter=line"),
    cli(refused),
  );
}
rmSync(recorded, { force: true });
const filtered = await runSuiteWith(
  recordingPlaywright,
  ["--port", String(portA), "-g", "smoke home"],
  envFor(runDir, {
    PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(scratch, "SYNTH-html"),
    PLAYWRIGHT_HTML_REPORT: path.join(scratch, "SYNTH-html-report"),
    PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(scratch, "SYNTH.json"),
    PW_TEST_HTML_REPORT_OPEN: "always",
    PLAYWRIGHT_BROWSERS_PATH: path.join(scratch, "browsers"),
  }),
);
const seen = existsSync(recorded)
  ? JSON.parse(readFileSync(recorded, "utf8"))
  : null;
check(
  "smoke passes only the title filter after its own config and spec",
  filtered.status === 0 &&
    seen !== null &&
    seen.argv.length === 6 &&
    seen.argv[0] === "test" &&
    seen.argv[1] === "--config" &&
    seen.argv[2].endsWith("playwright.config.mjs") &&
    seen.argv[3].endsWith("smoke.spec.ts") &&
    seen.argv[4] === "--grep" &&
    seen.argv[5] === "smoke home",
  cli(filtered),
);
check(
  "Playwright gets no inherited report or open-behaviour variables",
  seen !== null &&
    seen.htmlOpen === "never" &&
    seen.playwrightEnv.every((key) =>
      ["PLAYWRIGHT_BROWSERS_PATH", "PLAYWRIGHT_HTML_OPEN"].includes(key),
    ),
  seen ? seen.playwrightEnv.length : null,
);

// The npm entry point ignores VERIFY_PLAYWRIGHT_CLI, the round-4 test hook:
// with it set, the real Playwright runs (a -g that matches no test makes it
// exit at once, before any browser starts) and the stand-in never does.
const hookMarker = path.join(scratch, "hook-ran");
const hookPlaywright = standInPlaywright(
  "hook-playwright",
  `fs.writeFileSync(${JSON.stringify(hookMarker)}, "ran");
fs.writeFileSync(process.env.VERIFY_REPORT_FILE, JSON.stringify({ suites: [], errors: [], stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 } }));
process.exit(0);
`,
);
const hooked = await runNpm(
  [
    "--silent",
    "run",
    "verify:smoke",
    "--",
    "--port",
    String(portA),
    "-g",
    "SYNTH-no-such-test",
  ],
  envFor(runDir, { VERIFY_PLAYWRIGHT_CLI: hookPlaywright }),
);
const smokeLog = path.join(runDir, "smoke.log");
check(
  "npm run verify:smoke ignores VERIFY_PLAYWRIGHT_CLI and runs the real Playwright",
  hooked.status !== 0 &&
    !existsSync(hookMarker) &&
    readFileSync(smokeLog, "utf8").includes("No tests found"),
  cli(hooked),
);
check(
  "smoke.mjs reads no runner from the environment",
  !/process\.env\.VERIFY_PLAYWRIGHT_CLI|VERIFY_PLAYWRIGHT_CLI/.test(
    readFileSync(path.join(scriptDir, "smoke.mjs"), "utf8") +
      readFileSync(path.join(scriptDir, "suite.mjs"), "utf8"),
  ),
);

// Finding 3 of round 4: the HTML report and traces embed raw test output.
// The config writes them under the private raw directory suite.mjs passes,
// never under the evidence directory, and the optional workflow uploads
// nothing and keeps its install output in files on the runner.
const configProbe = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `const { default: config } = await import(${JSON.stringify(new URL("../playwright.config.mjs", import.meta.url).href)});
const html = config.reporter.filter(([name]) => name === "html").map(([, options]) => options.outputFolder);
process.stdout.write(JSON.stringify({ outputDir: config.outputDir, html }));`,
  ],
  {
    cwd: runtime.skillDir,
    encoding: "utf8",
    env: {
      ...process.env,
      VERIFY_EVIDENCE_DIR: "/tmp/sxv-probe/evidence",
      VERIFY_RAW_DIR: "/tmp/sxv-probe/state/playwright/drive",
      VERIFY_SUITE: "drive",
    },
  },
);
let configPaths = { outputDir: "", html: [] };
try {
  configPaths = JSON.parse(configProbe.stdout);
} catch {
  // Reported by the check below.
}
const rawPaths = [configPaths.outputDir, ...configPaths.html];
check(
  "Playwright writes its HTML report and traces to the private raw directory, not evidence",
  configProbe.status === 0 &&
    configPaths.html.length === 1 &&
    rawPaths.every(
      (file) =>
        typeof file === "string" &&
        file.startsWith("/tmp/sxv-probe/state/playwright/drive/") &&
        !file.startsWith("/tmp/sxv-probe/evidence"),
    ),
  { status: configProbe.status, paths: rawPaths.length },
);
check(
  "smoke's raw Playwright directory is private",
  (lstatSync(path.join(runDir, "playwright")).mode & 0o777) === 0o700 &&
    (lstatSync(path.join(runDir, "playwright", "smoke")).mode & 0o777) ===
      0o700,
);
const workflow = readFileSync(
  path.join(runtime.repoRoot, ".github/workflows/verify-smoke.yml"),
  "utf8",
);
const installLines = workflow
  .split("\n")
  .filter((line) => /\bnpm ci\b|playwright install/.test(line))
  .filter((line) => !/^(#|echo\b)/.test(line.trim()));
check(
  "the verify workflow uploads nothing and keeps install output off the log",
  !/upload-artifact|actions\/upload/.test(workflow) &&
    installLines.length === 2 &&
    installLines.every((line) =>
      /> "\$RUNNER_TEMP\/[\w.-]+\.log" 2>&1/.test(line),
    ),
  { installLines: installLines.length },
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
  cli(doctorForeign),
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
  { proven: wrongToken.proven },
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
  cli(runCleanup),
);
check(
  "cleanup leaves a same-checkout server, its child, and an outside process running",
  running(strangerB.pids.app) &&
    running(strangerB.pids.grandchild) &&
    !exited(outsider) &&
    !exited(victim),
);
// Finding 1 of round 4: no stale supervisor pid survives cleanup.
check(
  "the run's port is free and its socket, token, supervisor pid, and lock are gone",
  !(await runtime.tcpOpen(portA)) &&
    !existsSync(runtime.socketPath(runDir)) &&
    !existsSync(runtime.lockPath(runDir)) &&
    runtime.readState(runDir)?.token === undefined &&
    runtime.readState(runDir)?.supervisorPid === undefined,
);
const againCleanup = await runCli("cleanup.mjs", [], envFor(runDir));
check(
  "a second cleanup has nothing to stop",
  againCleanup.status === 0 && againCleanup.stdout.includes("already stopped"),
  cli(againCleanup),
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
  { owned: takenOwnership.owned },
);
const takenDoctor = await runCli(
  "doctor.mjs",
  ["--port", String(portC)],
  envFor(takenDir),
);
check(
  "doctor is not READY when a stranger holds the run's port",
  takenDoctor.status === 2 && takenDoctor.stdout.includes("foreign-server"),
  cli(takenDoctor),
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
  cli(takenCleanup),
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
  cli(orphanCleanup),
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
  cli(escapeCleanup),
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
  cli(lingerCleanup),
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
  {
    spawns: raceSpawns(),
    lockRefused: raceLoser instanceof runtime.StateLockedError,
    proven: raceStatus.proven,
  },
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
    { ...cli(refused), connections: staleSocket.connections.count },
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
  { refused: lockless.includes("needs the lock") },
);

// The supervisor's spawner can end it through the handle it holds (this
// check's ChildProcess, never a saved pid): the group goes with it.
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
  cli(foreignCleanup),
);
foreignSocket.close();

// Another next dev on a port is named by pid and cwd, never stopped. It
// holds a lifeline like every other stand-in.
const holderScript = path.join(scratch, "next");
const holderPortFile = path.join(scratch, "holder-port");
writeFileSync(
  holderScript,
  `const net = require("net");
const fs = require("fs");
const lifeline = net.connect(${JSON.stringify(lifelinePath)});
lifeline.write(JSON.stringify({ name: "holder", role: "next", pid: process.pid }) + "\\n");
lifeline.once("close", () => process.exit(0));
lifeline.on("error", () => {});
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
await standInsOf("holder", ["next"]);
const holderPort = Number(readFileSync(holderPortFile, "utf8"));
const foreignNext = runtime.formatForeignNext(holderPort);
check(
  "foreign next listener",
  foreignNext.includes(`pid ${holder.pid}`) &&
    foreignNext.includes("another next dev") &&
    !foreignNext.includes(holderScript),
  { length: foreignNext.length },
);

// Finding 6 of round 4: the sleepers and the fake next end through their
// lifelines alone. Nothing signals them here; their exits are read from the
// ChildProcess handles.
const helpers = [
  standIn("victim", "sleeper"),
  standIn("outsider", "sleeper"),
  standIn("holder", "next"),
];
const helpersHeld = helpers.every(running);
await release(helpers.filter(Boolean));
await waitUntil(() => exited(victim) && exited(outsider) && exited(holder));
check(
  "the sleepers and the fake next hold lifelines and exit when they close",
  helpersHeld && exited(victim) && exited(outsider) && exited(holder),
  { held: helpersHeld },
);

for (const { dir, state, child } of supervised) {
  if (state && child && !exited(child)) await runtime.stopRun(state, { dir });
}
teardown();
check(
  "every stand-in this check started has exited",
  (await release(standIns)) && standIns.length > 0,
  { running: standIns.filter(running).length },
);
lifeline.close();
// Finding 1 of round 3: the check never signals a process group it saved.
check(
  "the check signals no process group",
  !/process\.kill\(\s*-/.test(
    readFileSync(fileURLToPath(import.meta.url), "utf8"),
  ),
);

// Finding 1 of round 4: no instruction offers a recorded pid as a way to
// stop a run. Cleanup is the only stop; a person stops a process only after
// checking its identity freshly.
const skillDocs = [
  path.join(runtime.skillDir, "SKILL.md"),
  path.join(runtime.repoRoot, "AGENTS.md"),
  path.join(runtime.repoRoot, "CLAUDE.md"),
  ...readdirSync(path.join(runtime.skillDir, "references", "features")).map(
    (name) => path.join(runtime.skillDir, "references", "features", name),
  ),
  ...readdirSync(scriptDir)
    .filter((name) => name !== "runtime.check.mjs")
    .map((name) => path.join(scriptDir, name)),
];
const manualKill =
  /kill\s+<supervisor|supervisor pid[^\n.]*\bkill\b|\bkill\b[^\n.]*(?:run\.json|supervisorPid)/i;
const offersRecordedPid = skillDocs.filter((file) =>
  manualKill.test(readFileSync(file, "utf8")),
);
check(
  "no doc or script offers a recorded supervisor pid as a manual stop",
  offersRecordedPid.length === 0 && skillDocs.length > 5,
  { files: offersRecordedPid.length },
);

// ---- Launch failures ---------------------------------------------------------

// Finding 2 of round 4: a failed launch prints a fixed message (what failed,
// how it exited, the log path) and never any of the log. The real launch,
// runtime, and supervisor are copied into a scratch checkout whose npm,
// Playwright CLI, and next are stand-ins: each prints every form the reviewer
// found leaking past the old redacted excerpt, around a canary, and exits 1.
// Nothing real is installed or started.
const launchCanary = "SYNTH-r4-launch-canary";
const leakForms = [
  `Error: {"token":"${launchCanary}"}`,
  `error: {"token": {"nested": {"value":"${launchCanary}"}}}`,
  `tokens:\n- ${launchCanary}`,
  String.raw`warn {"msg":"https:\/\/default:${launchCanary}@registry.example.invalid\/pkg"}`,
  `${'{"a":'.repeat(8000)}{"token":"${launchCanary}"}${"}".repeat(8000)}`,
  `plain ${launchCanary}`,
].join("\n");
const leakFile = path.join(scratch, "leak-forms.txt");
writeFileSync(leakFile, `${leakForms}\n`);
const leakyTool = path.join(scratch, "leaky-tool.cjs");
writeFileSync(
  leakyTool,
  `const text = require("fs").readFileSync(${JSON.stringify(leakFile)}, "utf8");
process.stdout.write(text);
process.stderr.write(text);
process.exit(1);
`,
);

function fakeCheckout(name, { modules = false } = {}) {
  const root = path.join(scratch, name);
  const scripts = path.join(root, ".agents/skills/verify-scrutinix/scripts");
  mkdirSync(scripts, { recursive: true });
  for (const file of [
    "runtime.mjs",
    "launch.mjs",
    "supervisor.mjs",
    "cleanup.mjs",
  ]) {
    copyFileSync(path.join(scriptDir, file), path.join(scripts, file));
  }
  if (modules) {
    for (const file of [
      "node_modules/@playwright/test/cli.js",
      "node_modules/next/dist/bin/next.js",
    ]) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      copyFileSync(leakyTool, path.join(root, file));
    }
  }
  return {
    root,
    launch: path.join(scripts, "launch.mjs"),
    cleanup: path.join(scripts, "cleanup.mjs"),
  };
}
const leakyBin = path.join(scratch, "leaky-bin");
mkdirSync(leakyBin);
writeFileSync(
  path.join(leakyBin, "npm"),
  `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(leakyTool)} "$@"\n`,
  { mode: 0o755 },
);

const noModules = fakeCheckout("checkout-no-modules");
const withModules = fakeCheckout("checkout-modules", { modules: true });
for (const [label, checkoutCopy, logName, category, extra] of [
  [
    "npm ci",
    noModules,
    "install.log",
    "npm ci failed (exited 1)",
    {
      PATH: `${leakyBin}${path.delimiter}${process.env.PATH ?? ""}`,
      VERIFY_SKIP_BROWSER_INSTALL: "1",
    },
  ],
  [
    "browser install",
    withModules,
    "browsers.log",
    "browser install failed. Run: npx playwright install --with-deps chromium (exited 1)",
    { VERIFY_SKIP_BROWSER_INSTALL: "" },
  ],
  [
    "next dev",
    withModules,
    "next.log",
    "next dev exited (exited 1)",
    { VERIFY_SKIP_BROWSER_INSTALL: "1" },
  ],
]) {
  const dir = privateDir(`launch-fail-${logName.split(".")[0]}`);
  const failed = await runCli(
    checkoutCopy.launch,
    ["--port", String(await freePort())],
    envFor(dir, extra),
  );
  const log = path.join(dir, logName);
  const printed = `${failed.stdout}${failed.stderr}`;
  check(
    `a launch whose ${label} fails prints a fixed message and none of its log`,
    failed.status === 1 &&
      failed.stderr.includes(
        `launch: ${category}. Log: ${log} (raw, mode 0600`,
      ) &&
      !printed.includes(launchCanary) &&
      !printed.includes("RangeError") &&
      !printed.includes('{"a":') &&
      readFileSync(log, "utf8").includes(launchCanary),
    { status: failed.status, canaryPrinted: printed.includes(launchCanary) },
  );
  // A failed next dev leaves its supervisor; cleanup ends it by the token.
  if (label === "next dev") {
    await runCli(checkoutCopy.cleanup, [], envFor(dir));
  }
}

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
  { status: capture.status },
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
  { found: Boolean(e2eKey), same: launchKey === e2eKey },
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
  { restored: restored.action === "restored" },
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
  { left: left.action === "left" },
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
check("restart repo committed", committed.status === 0, {
  status: committed.status,
});
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
  { kept: keptSnap.kept === true },
);
const restartRestore = runtime.restoreNextEnvSnapshot(gitRoot);
const restartStatus = git(["status", "--porcelain"]);
check(
  "restart git status clean",
  restartRestore.action === "restored" && restartStatus.stdout.trim() === "",
  {
    status: restartStatus.status,
    changed: restartStatus.stdout.split("\n").filter(Boolean).length,
  },
);
const consumed = runtime.snapshotNextEnv(gitRoot);
check(
  "cleanup consumed snapshot",
  consumed.kept !== true && consumed.snapshot === originalDeclaration,
  { kept: consumed.kept === true },
);
writeFileSync(path.join(gitRoot, "next-env.d.ts"), "rewritten again\n");
const dropped = runtime.snapshotNextEnv(gitRoot);
check(
  "drop snapshot when file matches neither",
  dropped.dropped === true &&
    dropped.kept !== true &&
    dropped.snapshot === "rewritten again\n" &&
    String(dropped.warning).includes("Dropping the old snapshot"),
  { dropped: dropped.dropped === true },
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
  cli(unfinished),
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
  { left: leftRuns.length },
);
if (leftRuns.length) {
  process.stderr.write(
    `runtime.check: kept ${scratch}. Stop each run there with VERIFY_STATE_DIR=${scratch}/<dir> npm run verify:cleanup\n`,
  );
}

// Finding 4 of round 4. A seeded run state, and text that carries its token
// and a canary, print only as kinds and sizes.
const seededState = runRecord({ token: "c".repeat(64), runId: "SYNTH-seeded" });
const seededDetail = formatDetail({
  state: seededState,
  text: `token=${seededState.token} SYNTH-detail-canary`,
  tokens: [seededState.token],
  status: 1,
  proven: false,
});
check(
  "a check's detail prints no string, object, or run token",
  !seededDetail.includes(seededState.token) &&
    !seededDetail.includes("SYNTH-") &&
    seededDetail ===
      `state=<object> text=<string, ${70 + "SYNTH-detail-canary".length + 1} chars> tokens=<array, 1 items> status=1 proven=false` &&
    formatDetail(JSON.stringify(seededState)).startsWith("detail=<string,"),
  { length: seededDetail.length },
);
// And no line any check in this run would have printed holds a token this
// run used or a synthetic canary.
const runTokens = [
  token("a"),
  token("b"),
  ...supervised.map((entry) => entry.state?.token).filter(Boolean),
];
const leakingLines = checkLines.filter(
  (line) =>
    line.includes("SYNTH-") || runTokens.some((value) => line.includes(value)),
);
check(
  "no check line holds a run token or a canary",
  leakingLines.length === 0 && runTokens.length > 2,
  { lines: leakingLines.length },
);
chmodSync(loose, 0o700);
if (!leftRuns.length) rmSync(scratch, { recursive: true, force: true });

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("runtime.check passed\n");
