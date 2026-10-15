import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
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

const server = net.createServer();
await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
let ssOutput = "";
try {
  ssOutput = execFileSync("ss", ["-ltnp", `sport = :${port}`], {
    encoding: "utf8",
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  ssOutput = message;
}
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
server.close();

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
  restored.action === "restored" && readFileSync(decl, "utf8") === "user edit\n",
  restored.warning,
);

writeFileSync(decl, "next wrote this\n");
runtime.snapshotNextEnv(declRoot);
runtime.recordNextEnvWritten(declRoot);
writeFileSync(decl, "edited after\n");
const left = runtime.restoreNextEnvSnapshot(declRoot);
check(
  "leave later edit",
  left.action === "left" &&
    readFileSync(decl, "utf8") === "edited after\n" &&
    left.warning.includes("Leaving it unchanged"),
  left.warning,
);

check(
  "next dev command",
  runtime.isNextDevCommand(
    "node /workspace/node_modules/.bin/next dev --port 3000",
  ),
);
check(
  "next-server command",
  runtime.isNextDevCommand("next-server (v16.4.0)"),
);
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

rmSync(scratch, { recursive: true, force: true });

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("runtime.check passed\n");
