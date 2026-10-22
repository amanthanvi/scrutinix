import { execFileSync, spawn, spawnSync } from "node:child_process";
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

const spaced = runtime.parseListenerPids("users:(('node',pid 4321,fd=9))");
check("pid space", spaced.length === 1 && spaced[0] === 4321, spaced.join(","));
check(
  "empty repo root is not a listener match",
  runtime.commandIncludesCheckout("node /tmp/next dev", "") === false &&
    runtime.commandIncludesCheckout("node /tmp/next dev", undefined) === false,
);
check(
  "repo root matches its checkout",
  runtime.commandIncludesCheckout(
    "node /tmp/scrutinix-clean/node_modules/next dev",
    "/tmp/scrutinix-clean",
  ),
);

const server = net.createServer();
await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
let ssOutput = "";
let ssMissing = false;
try {
  ssOutput = execFileSync("ss", ["-ltnp", `sport = :${port}`], {
    encoding: "utf8",
  });
} catch (error) {
  if (error && error.code === "ENOENT") ssMissing = true;
  else ssOutput = error instanceof Error ? error.message : String(error);
}
if (ssMissing) {
  const fromProc = runtime.listenerPids(port);
  check(
    "ss missing, /proc pid",
    fromProc.includes(process.pid),
    fromProc.join(","),
  );
} else {
  const parsed = runtime.parseListenerPids(ssOutput);
  check(
    "real ss uses pid=",
    ssOutput.includes("pid="),
    ssOutput.trim().slice(0, 500),
  );
  check(
    "real ss pid parsed",
    parsed.includes(process.pid),
    `pids ${parsed.join(",")} output ${ssOutput.trim()}`,
  );
}

const awk = spawnSync(
  "awk",
  [
    "-v",
    `port=${port}`,
    `function fromhex(s,    i, c, n, d) {
  n = 0
  for (i = 1; i <= length(s); i++) {
    c = tolower(substr(s, i, 1))
    d = index("0123456789abcdef", c)
    if (d == 0) return -1
    n = n * 16 + (d - 1)
  }
  return n
}
NR > 1 && $4 == "0A" {
  split($2, a, ":")
  if (fromhex(a[2]) == port) print $10
}`,
    "/proc/net/tcp",
    "/proc/net/tcp6",
  ],
  { encoding: "utf8" },
);
check(
  "portable awk finds listener inode",
  awk.status === 0 && /^\d+$/m.test(awk.stdout.trim()),
  `${awk.stdout}${awk.stderr}`,
);
server.close();

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
  "stop hint works without ss",
  hint.includes("/proc/net/tcp") &&
    hint.includes("/proc/<pid>/fd") &&
    hint.includes("kill <pid>"),
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

const sessionName = "scrutinix-verify-check-record";
const started = runtime.startTmuxSession(
  sessionName,
  "#!/usr/bin/env bash\nsleep 30\n",
);
const recorded = runtime.readState();
check("session recorded at start", recorded?.sessions?.includes(sessionName));
check(
  "repoRoot recorded at start",
  recorded?.repoRoot === runtime.canonicalPath(runtime.repoRoot),
  String(recorded?.repoRoot),
);
check("log path returned", Boolean(started.logPath));
runtime.killTmuxSession(sessionName);

const { bin, prefix } = runtime.tmuxCommand();
const foreignName = "scrutinix-verify-check-foreign";
const foreignDir = path.join(scratch, "foreign");
mkdirSync(foreignDir, { mode: 0o700 });
writeFileSync(
  path.join(foreignDir, "run.json"),
  `${JSON.stringify(
    {
      repoRoot: "/tmp/other-scrutinix-checkout",
      sessions: [foreignName],
      pids: [process.pid],
    },
    null,
    2,
  )}\n`,
);
const created = spawnSync(
  bin,
  [...prefix, "new-session", "-d", "-s", foreignName, "--", "sleep", "30"],
  { encoding: "utf8" },
);
check(
  "foreign session started",
  created.status === 0,
  created.stderr || created.stdout,
);
const cleanup = spawnSync(
  process.execPath,
  [path.join(scriptDir, "cleanup.mjs")],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      VERIFY_STATE_DIR: foreignDir,
      VERIFY_EVIDENCE_DIR: path.join(foreignDir, "evidence"),
    },
  },
);
const stillThere = spawnSync(
  bin,
  [...prefix, "has-session", "-t", foreignName],
  { encoding: "utf8" },
);
check(
  "cleanup leaves another checkout running",
  cleanup.status === 0 && stillThere.status === 0,
  `${cleanup.stdout}\n${cleanup.stderr}`,
);
spawnSync(bin, [...prefix, "kill-session", "-t", foreignName], {
  encoding: "utf8",
});

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
  stdio: "ignore",
});
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
    foreignNext.includes("another next dev"),
  foreignNext,
);
holder.kill("SIGTERM");

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
