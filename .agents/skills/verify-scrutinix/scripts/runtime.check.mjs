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
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(path.join(tmpdir(), "sx-verify-check-"));
const stateDir = path.join(scratch, "state");
const evidenceDir = path.join(stateDir, "evidence");
process.env.VERIFY_STATE_DIR = stateDir;
process.env.VERIFY_EVIDENCE_DIR = evidenceDir;

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

const noSsDir = path.join(scratch, "no-ss");
mkdirSync(noSsDir);
const noSsNext = path.join(scratch, "next");
const noSsPortFile = path.join(scratch, "no-ss-port");
writeFileSync(
  noSsNext,
  `const net = require("net");
const fs = require("fs");
const server = net.createServer();
server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(process.argv[2], String(server.address().port));
});
setInterval(() => {}, 1000);
`,
);
const noSsProbe = path.join(scratch, "no-ss-probe.mjs");
writeFileSync(
  noSsProbe,
  `import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { formatForeignNext } from ${JSON.stringify(path.join(scriptDir, "runtime.mjs"))};
const child = spawn(process.execPath, [process.argv[2], process.argv[3]], {
  stdio: "ignore",
});
const deadline = Date.now() + 2000;
let listenPort = 0;
while (Date.now() < deadline) {
  try {
    listenPort = Number(readFileSync(process.argv[3], "utf8"));
    if (listenPort > 0) break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const hint = formatForeignNext(listenPort);
child.kill("SIGTERM");
if (!hint.includes("another next dev") || !hint.includes("pid " + child.pid)) {
  process.stderr.write(hint + "\\n");
  process.exit(1);
}
process.stdout.write(hint + "\\n");
`,
);
const noSs = spawnSync(process.execPath, [noSsProbe, noSsNext, noSsPortFile], {
  encoding: "utf8",
  env: { ...process.env, PATH: noSsDir },
});
check(
  "listener pids without ss",
  noSs.status === 0 &&
    noSs.stdout.includes("another next dev") &&
    noSs.stdout.includes("pid ") &&
    noSs.stderr.includes("ENOENT") === false,
  `status ${noSs.status} stdout ${noSs.stdout} stderr ${noSs.stderr}`,
);

function runCli(script, args) {
  return spawnSync(process.execPath, [path.join(scriptDir, script), ...args], {
    encoding: "utf8",
    env: process.env,
  });
}

for (const script of ["launch.mjs", "doctor.mjs"]) {
  const invalid = runCli(script, ["--base-url", "not a url"]);
  check(
    `${script} rejects invalid base url`,
    invalid.status === 2 &&
      invalid.stderr.includes("not a valid URL") &&
      !`${invalid.stdout}${invalid.stderr}`.includes("TypeError"),
    `status ${invalid.status} ${invalid.stderr}`,
  );
  const empty = runCli(script, ["--base-url", ""]);
  check(
    `${script} rejects empty base url`,
    empty.status === 2 && empty.stderr.includes("needs a URL"),
    `status ${empty.status} ${empty.stderr}`,
  );
  const missing = runCli(script, ["--base-url"]);
  check(
    `${script} rejects missing base url`,
    missing.status === 2 && missing.stderr.includes("needs a URL"),
    `status ${missing.status} ${missing.stderr}`,
  );
  const equalsEmpty = runCli(script, ["--base-url="]);
  check(
    `${script} rejects empty equals base url`,
    equalsEmpty.status === 2 && equalsEmpty.stderr.includes("needs a URL"),
    `status ${equalsEmpty.status} ${equalsEmpty.stderr}`,
  );
  const equalsInvalid = runCli(script, ["--base-url=not-a-url"]);
  check(
    `${script} rejects invalid equals base url`,
    equalsInvalid.status === 2 &&
      equalsInvalid.stderr.includes("not a valid URL") &&
      !`${equalsInvalid.stdout}${equalsInvalid.stderr}`.includes("TypeError"),
    `status ${equalsInvalid.status} ${equalsInvalid.stderr}`,
  );
}
const equalsParsed = runtime.parseCliBaseUrl([
  "node",
  "launch.mjs",
  "--base-url=http://127.0.0.1:3000",
]);
check(
  "equals base url is parsed",
  equalsParsed.ok === true && equalsParsed.baseUrl === "http://127.0.0.1:3000",
  equalsParsed.baseUrl,
);
const equalsOther = runCli("launch.mjs", ["--base-url=http://example.com"]);
check(
  "equals base url does not fall back",
  equalsOther.status === 2 &&
    equalsOther.stderr.includes("refusing http://example.com"),
  equalsOther.stderr,
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
const symlinkCheck = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `import { ensureDirs } from ${JSON.stringify(path.join(scriptDir, "runtime.mjs"))};
try {
  ensureDirs();
  process.exit(2);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.exit(message.includes("real directory") ? 0 : 3);
}`,
  ],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      VERIFY_STATE_DIR: linked,
      VERIFY_EVIDENCE_DIR: path.join(linked, "evidence"),
    },
  },
);
check(
  "reject symlink state dir",
  symlinkCheck.status === 0,
  symlinkCheck.stderr || symlinkCheck.stdout || `status ${symlinkCheck.status}`,
);

// ---- Process and session identity -----------------------------------------

const { bin, prefix } = runtime.tmuxCommand();
const tmux = (args) =>
  spawnSync(bin, [...prefix, ...args], { encoding: "utf8" });
const checkout = runtime.canonicalPath(runtime.repoRoot);

function runCleanup(dir) {
  return spawnSync(process.execPath, [path.join(scriptDir, "cleanup.mjs")], {
    encoding: "utf8",
    env: {
      ...process.env,
      VERIFY_STATE_DIR: dir,
      VERIFY_EVIDENCE_DIR: path.join(dir, "evidence"),
    },
  });
}

function stateDirWith(name, state) {
  const dir = path.join(scratch, name);
  mkdirSync(dir, { mode: 0o700 });
  mkdirSync(path.join(dir, "evidence"), { mode: 0o700 });
  writeFileSync(
    path.join(dir, "run.json"),
    `${JSON.stringify({ baseUrl: "http://127.0.0.1:3000", ...state }, null, 2)}\n`,
  );
  return dir;
}

// A long-lived child this check starts and later stops by its exact handle.
const children = [];
async function startChild(cwd) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    cwd,
    stdio: "ignore",
  });
  children.push(child);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const identity = runtime.processIdentity(child.pid);
    if (identity?.cwd) return { child, identity };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { child, identity: runtime.processIdentity(child.pid) };
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
  "listener pids find this process",
  runtime.listenerPids(probePort).includes(process.pid),
  runtime.listenerPids(probePort).join(","),
);
const details = runtime.portDetails(probePort);
check(
  "port details are identity fields, not a command line",
  details.includes(`pid ${process.pid}, started `) &&
    !details.includes("runtime.check.mjs"),
  details,
);
listenProbe.close();

// Reused pid: the recorded start time is not the running process's.
const { child: reusedChild, identity: reusedIdentity } = await startChild(
  runtime.repoRoot,
);
check(
  "child serves this checkout",
  runtime.canonicalPath(reusedIdentity?.cwd ?? "") === checkout,
  JSON.stringify(reusedIdentity),
);
const reusedRecord = {
  ...reusedIdentity,
  startTime: "Thu Jan  1 00:00:00 1970",
};
check(
  "identityProblem names a reused pid",
  runtime
    .identityProblem(reusedRecord, reusedIdentity)
    .includes("the pid was reused"),
);
check(
  "identityProblem names a different executable",
  runtime
    .identityProblem(
      { ...reusedIdentity, executable: "/usr/bin/some-other-binary" },
      reusedIdentity,
    )
    .includes("runs "),
);
check(
  "identityProblem refuses a record without its fields",
  runtime.identityProblem({ pid: reusedIdentity.pid }, reusedIdentity) !== "",
);
const reusedPidDir = stateDirWith("reused-pid", {
  repoRoot: checkout,
  sessions: [],
  listeners: [reusedRecord],
});
const reusedPidCleanup = runCleanup(reusedPidDir);
check(
  "cleanup refuses a reused pid and leaves it running",
  reusedPidCleanup.status === 1 &&
    reusedPidCleanup.stderr.includes("the pid was reused") &&
    alive(reusedChild.pid),
  `${reusedPidCleanup.status} ${reusedPidCleanup.stdout}\n${reusedPidCleanup.stderr}`,
);
const legacyPidDir = stateDirWith("legacy-pid", {
  repoRoot: checkout,
  sessions: [],
  pids: [reusedChild.pid],
});
const legacyPidCleanup = runCleanup(legacyPidDir);
check(
  "cleanup refuses a bare recorded pid",
  legacyPidCleanup.status === 1 &&
    legacyPidCleanup.stderr.includes("no recorded process identity") &&
    alive(reusedChild.pid),
  `${legacyPidCleanup.stdout}\n${legacyPidCleanup.stderr}`,
);
const matched = runtime.stopRecordedProcess(reusedIdentity);
await new Promise((resolve) => setTimeout(resolve, 300));
check(
  "an exact identity match is stopped",
  matched.action === "stopped" && !alive(reusedChild.pid),
  matched.message,
);

// Another checkout: the record is accurate, but the process serves a
// different directory, so this checkout's cleanup must not stop it.
const otherCheckout = path.join(scratch, "other-checkout");
mkdirSync(otherCheckout);
const { child: otherChild, identity: otherIdentity } =
  await startChild(otherCheckout);
const otherDir = stateDirWith("other-checkout-state", {
  repoRoot: checkout,
  sessions: [],
  listeners: [otherIdentity],
});
const otherCleanup = runCleanup(otherDir);
check(
  "cleanup refuses a process serving another checkout",
  otherCleanup.status === 1 &&
    otherCleanup.stderr.includes("not this checkout") &&
    alive(otherChild.pid),
  `${otherCleanup.stdout}\n${otherCleanup.stderr}`,
);
check(
  "stopRecordedProcess refuses another checkout",
  runtime.stopRecordedProcess(otherIdentity).action === "refused" &&
    alive(otherChild.pid),
);

// The session this launch started is recorded by identity, not name.
const sessionName = `scrutinix-verify-check-${process.pid}`;
const started = runtime.startTmuxSession(
  sessionName,
  "#!/usr/bin/env bash\nsleep 30\n",
);
const recorded = runtime.readState();
const recordedSession = recorded?.sessions?.find(
  (entry) => entry?.name === sessionName,
);
check(
  "session identity recorded at start",
  Boolean(
    recordedSession?.id?.startsWith("$") &&
    recordedSession.created &&
    recordedSession.pane?.pid > 0 &&
    recordedSession.pane.startTime &&
    runtime.canonicalPath(recordedSession.pane.cwd) === checkout,
  ),
  JSON.stringify(recordedSession),
);
check(
  "repoRoot recorded at start",
  recorded?.repoRoot === checkout,
  String(recorded?.repoRoot),
);
check("log path returned", Boolean(started.logPath));
check(
  "recorded session matches itself",
  runtime.sessionProblem(recordedSession).problem === "",
);

// Reused session name: ours ended, and someone else made one with the same
// name. tmux also prefix-matches names, so a longer name must not count.
tmux(["kill-session", "-t", recordedSession.id]);
const impostor = tmux([
  "new-session",
  "-d",
  "-P",
  "-F",
  "#{session_id}",
  "-s",
  sessionName,
  "--",
  "sleep",
  "30",
]);
const impostorId = impostor.stdout.trim();
check("impostor session started", impostor.status === 0, impostor.stderr);
const reusedNameDir = stateDirWith("reused-name", {
  repoRoot: checkout,
  sessions: [recordedSession],
  listeners: [],
});
const reusedNameCleanup = runCleanup(reusedNameDir);
const impostorAlive = runtime.tmuxSessionIdentity(sessionName);
check(
  "cleanup refuses a reused session name and leaves it running",
  reusedNameCleanup.status === 1 &&
    reusedNameCleanup.stderr.includes("the name was reused") &&
    impostorAlive?.id === impostorId,
  `${reusedNameCleanup.stdout}\n${reusedNameCleanup.stderr}`,
);
const nameOnlyDir = stateDirWith("name-only", {
  repoRoot: checkout,
  sessions: [sessionName],
  listeners: [],
});
const nameOnlyCleanup = runCleanup(nameOnlyDir);
check(
  "cleanup refuses a session recorded by name only",
  nameOnlyCleanup.status === 1 &&
    nameOnlyCleanup.stderr.includes("a session name is not ownership") &&
    runtime.tmuxSessionIdentity(sessionName)?.id === impostorId,
  `${nameOnlyCleanup.stdout}\n${nameOnlyCleanup.stderr}`,
);
check(
  "a name prefix is not a session",
  runtime.tmuxSessionIdentity(sessionName.slice(0, -2)) === null,
);
tmux(["kill-session", "-t", impostorId]);

// A run.json for another checkout is left alone entirely.
const foreignName = `scrutinix-verify-check-foreign-${process.pid}`;
const foreignCreated = tmux([
  "new-session",
  "-d",
  "-P",
  "-F",
  "#{session_id}",
  "-s",
  foreignName,
  "--",
  "sleep",
  "30",
]);
const foreignId = foreignCreated.stdout.trim();
check(
  "foreign session started",
  foreignCreated.status === 0,
  foreignCreated.stderr,
);
const foreignDir = stateDirWith("foreign", {
  repoRoot: otherCheckout,
  sessions: [{ name: foreignName, id: foreignId }],
  listeners: [otherIdentity],
});
const foreignCleanup = runCleanup(foreignDir);
check(
  "cleanup leaves another checkout running",
  foreignCleanup.status === 0 &&
    foreignCleanup.stdout.includes("Leaving that server running") &&
    runtime.tmuxSessionIdentity(foreignName)?.id === foreignId &&
    alive(otherChild.pid),
  `${foreignCleanup.stdout}\n${foreignCleanup.stderr}`,
);
tmux(["kill-session", "-t", foreignId]);

// Another checkout's run is live when a listener serves its directory.
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
const holder = spawn(process.execPath, [holderScript, "dev"], {
  cwd: otherCheckout,
  stdio: "ignore",
});
children.push(holder);
const holderPort = await new Promise((resolve) => {
  const deadline = Date.now() + 2_000;
  const tick = () => {
    try {
      resolve(Number(readFileSync(holderPortFile, "utf8")));
    } catch {
      if (Date.now() > deadline) resolve(0);
      else setTimeout(tick, 20);
    }
  };
  tick();
});
const foreignNext = runtime.formatForeignNext(holderPort);
check(
  "foreign next listener",
  foreignNext.includes(`pid ${holder.pid}`) &&
    foreignNext.includes("another next dev") &&
    !foreignNext.includes(holderScript),
  foreignNext,
);
check(
  "foreign run is live while its listener serves that checkout",
  runtime.foreignRunLive(
    { repoRoot: otherCheckout, sessions: [] },
    holderPort,
  ) &&
    !runtime.foreignRunLive(
      { repoRoot: path.join(scratch, "nobody"), sessions: [] },
      holderPort,
    ),
);
check(
  "this checkout's listeners exclude another checkout",
  runtime.checkoutListeners(holderPort).length === 0 &&
    runtime.checkoutListeners(holderPort, otherCheckout).length === 1,
);

for (const child of children) child.kill("SIGTERM");

// ---- Redaction ------------------------------------------------------------

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
]) {
  check(
    `redacts ${secret.slice(0, 12)}…`,
    !redacted.includes(secret),
    redacted,
  );
}
const benign =
  "▲ Next.js 16.3.8\n- Local: http://127.0.0.1:3000\n✓ Ready in 1.2s\nGET / 200 in 85ms\n/Users/me/GitRepos/scrutinix2/t3-c2a46879/node_modules/next/dist/server/lib/start-server.js";
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

// ---- Share key ------------------------------------------------------------

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

const declRoot = path.join(scratch, "decl");
mkdirSync(declRoot);
const decl = path.join(declRoot, "next-env.d.ts");
writeFileSync(decl, "user edit\n");
runtime.snapshotNextEnv(declRoot);
writeFileSync(decl, "next wrote this\n");
check("recorded written", runtime.recordNextEnvWritten(declRoot));
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

const unfinishedDir = path.join(scratch, "unfinished");
const unfinishedEvidence = path.join(unfinishedDir, "evidence");
mkdirSync(unfinishedDir, { mode: 0o700 });
mkdirSync(unfinishedEvidence, { mode: 0o700 });
writeFileSync(
  path.join(unfinishedDir, "next-env.json"),
  `${JSON.stringify({
    checkouts: {
      [runtime.canonicalPath(runtime.repoRoot)]: {
        missing: false,
        snapshot: "unfinished snapshot\n",
      },
    },
  })}\n`,
);
const unfinished = spawnSync(
  process.execPath,
  [path.join(scriptDir, "cleanup.mjs")],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      VERIFY_STATE_DIR: unfinishedDir,
      VERIFY_EVIDENCE_DIR: unfinishedEvidence,
    },
  },
);
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
  `${unfinished.stdout}\n${unfinished.stderr}`,
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

rmSync(scratch, { recursive: true, force: true });

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("runtime.check passed\n");
