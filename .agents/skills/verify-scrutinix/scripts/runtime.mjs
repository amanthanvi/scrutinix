import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(scriptDir, "../../../..");
export const skillDir = path.resolve(scriptDir, "..");
export const stateDir = process.env.VERIFY_STATE_DIR || "/tmp/scrutinix-verify";
export const evidenceDir =
  process.env.VERIFY_EVIDENCE_DIR || path.join(stateDir, "evidence");
export const stateFile = path.join(stateDir, "run.json");
export const defaultBaseUrl =
  process.env.E2E_BASE_URL || "http://127.0.0.1:3000";

export const sessions = {
  next: "scrutinix-verify-next",
};

const homeMarker = "URL to analyze";
const aboutMarker = "How a scan becomes a verdict.";
const privacyMarker = "History stays in the browser.";

const agentEnvNames = [
  "AI_AGENT",
  "CURSOR_TRACE_ID",
  "CURSOR_AGENT",
  "CURSOR_EXTENSION_HOST_ROLE",
  "GEMINI_CLI",
  "CODEX_SANDBOX",
  "CODEX_CI",
  "CODEX_THREAD_ID",
  "ANTIGRAVITY_AGENT",
  "AUGMENT_AGENT",
  "OPENCODE_CLIENT",
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CLAUDE_CODE_IS_COWORK",
  "REPL_ID",
  "COPILOT_MODEL",
  "COPILOT_ALLOW_ALL",
  "COPILOT_GITHUB_TOKEN",
];

const managedAgentBlocks = [
  ["<!-- BEGIN:nextjs-agent-rules -->", "<!-- END:nextjs-agent-rules -->"],
  [
    "<!-- BEGIN:nextjs-agent-feedback -->",
    "<!-- END:nextjs-agent-feedback -->",
  ],
  ["<!-- NEXT-AGENTS-MD-START -->", "<!-- NEXT-AGENTS-MD-END -->"],
];

export function canonicalPath(value) {
  const resolved = path.resolve(String(value));
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function sameCheckout(state) {
  if (!state || typeof state.repoRoot !== "string" || state.repoRoot === "") {
    return false;
  }
  return canonicalPath(state.repoRoot) === canonicalPath(repoRoot);
}

function assertPrivateDir(dir) {
  const stat = lstatSync(dir);
  const mode = stat.mode & 0o777;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(
      `verify: ${dir} must be a real directory owned by this user with mode 0700`,
    );
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid !== null && stat.uid !== uid) {
    throw new Error(
      `verify: ${dir} is owned by uid ${stat.uid}, expected ${uid}. Refusing to write scripts there.`,
    );
  }
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `verify: ${dir} is group or world accessible (mode 0${mode.toString(8)}). Refusing to write scripts there.`,
    );
  }
}

export function ensureDirs() {
  for (const dir of [stateDir, evidenceDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
    }
    assertPrivateDir(dir);
  }
}

export function readState() {
  if (!existsSync(stateFile)) return null;
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

export function writeState(state) {
  ensureDirs();
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

export function baseUrlParts(baseUrl) {
  const url = new URL(baseUrl);
  return {
    url,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    loopback: url.hostname === "127.0.0.1" || url.hostname === "localhost",
  };
}

export function tcpOpen(port, host = "127.0.0.1", timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "text/html" },
    });
    const text = await response.text();
    return { status: response.status, text, error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted = error instanceof Error && error.name === "AbortError";
    return { status: 0, text: "", error: aborted ? "timeout" : message };
  } finally {
    clearTimeout(timer);
  }
}

function listenInodes(port) {
  const inodes = new Set();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n").slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const local = parts[1];
      const state = parts[3];
      const inode = parts[9];
      const portHex = local?.split(":")[1];
      if (!portHex || state !== "0A" || !inode) continue;
      if (Number.parseInt(portHex, 16) === port) inodes.add(inode);
    }
  }
  return inodes;
}

export function portDetails(port) {
  try {
    const fromSs = execFileSync("ss", ["-ltnp", `sport = :${port}`], {
      encoding: "utf8",
    }).trim();
    if (fromSs) return fromSs;
  } catch {
    // ss is optional. /proc is the fallback.
  }

  const inodes = listenInodes(port);
  if (!inodes.size) return "";
  const rows = [];
  let dirents = [];
  try {
    dirents = readdirSync("/proc");
  } catch {
    return "";
  }
  for (const dirent of dirents) {
    if (!/^\d+$/.test(dirent)) continue;
    let fds = [];
    try {
      fds = readdirSync(`/proc/${dirent}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      let target = "";
      try {
        target = readlinkSync(`/proc/${dirent}/fd/${fd}`);
      } catch {
        continue;
      }
      if (!target.startsWith("socket:[") || !inodes.has(target.slice(8, -1))) {
        continue;
      }
      rows.push(`pid ${dirent} ${cmdline(dirent)}`);
    }
  }
  return rows.join("\n");
}

export function parseListenerPids(details) {
  const pids = new Set();
  for (const match of String(details).matchAll(/\bpid(?:=|\s+)(\d+)/g)) {
    const pid = Number(match[1]);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

export function listenerPids(port) {
  return parseListenerPids(portDetails(port));
}

export function isNextDevCommand(command) {
  if (!command) return false;
  if (command.includes("next-server")) return true;
  return /(^|[/\s])next(?=\s|$)/.test(command);
}

export function foreignNextListeners(port) {
  const found = [];
  for (const pid of listenerPids(port)) {
    const command = cmdline(pid);
    if (!isNextDevCommand(command)) continue;
    let cwd = "";
    try {
      cwd = readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      cwd = "";
    }
    found.push({ pid, command, cwd });
  }
  return found;
}

export function formatForeignNext(port) {
  const holders = foreignNextListeners(port);
  if (!holders.length) return "";
  const detail = holders
    .map((holder) => {
      const cwd = holder.cwd ? `, cwd ${holder.cwd}` : "";
      return `pid ${holder.pid}${cwd}`;
    })
    .join("; ");
  return `another next dev holds port ${port} (${detail}). This skill did not start it and will not stop it.`;
}

export function cmdline(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .replaceAll("\0", " ")
      .trim();
  } catch {
    return "";
  }
}

export function ownsInstance() {
  const state = readState();
  if (!sameCheckout(state)) return false;
  if (!Array.isArray(state.sessions)) return false;
  if (!state.sessions.includes(sessions.next)) return false;
  return sessionExists(sessions.next);
}

export function rememberRun(started, extra = {}) {
  const previous = readState();
  const base = previous && sameCheckout(previous) ? previous : null;
  const mergedSessions = new Set([
    ...(Array.isArray(base?.sessions) ? base.sessions : []),
    ...started,
  ]);
  const mergedPids = new Set([
    ...(Array.isArray(base?.pids) ? base.pids : []),
    ...(extra.pids ?? []),
  ]);
  writeState({
    baseUrl: extra.baseUrl || base?.baseUrl || defaultBaseUrl,
    evidenceDir,
    repoRoot: canonicalPath(repoRoot),
    sessions: [...mergedSessions],
    pids: [...mergedPids],
    fixtureMode: true,
    reused: extra.reused ?? started.length === 0,
    startedAt: base?.startedAt || new Date().toISOString(),
  });
}

function stripManagedBlocks(content) {
  let next = content;
  for (const [startMarker, endMarker] of managedAgentBlocks) {
    let guard = 0;
    while (guard < 5) {
      const startIdx = next.indexOf(startMarker);
      if (startIdx === -1) break;
      const endIdx = next.indexOf(endMarker, startIdx);
      if (endIdx === -1) break;
      let cutStart = startIdx;
      while (cutStart > 0 && /[\t ]/.test(next[cutStart - 1] ?? "")) {
        cutStart -= 1;
      }
      if (cutStart > 0 && next[cutStart - 1] === "\n") {
        cutStart -= 1;
        if (cutStart > 0 && next[cutStart - 1] === "\r") cutStart -= 1;
      }
      let cutEnd = endIdx + endMarker.length;
      while (cutEnd < next.length && /[\t ]/.test(next[cutEnd] ?? "")) {
        cutEnd += 1;
      }
      if (next[cutEnd] === "\r") cutEnd += 1;
      if (next[cutEnd] === "\n") cutEnd += 1;
      if (cutStart === 0) {
        if (next[cutEnd] === "\r") cutEnd += 1;
        if (next[cutEnd] === "\n") cutEnd += 1;
      }
      next = next.slice(0, cutStart) + next.slice(cutEnd);
      guard += 1;
    }
  }
  return next;
}

function nextEnvRecordPath() {
  return path.join(stateDir, "next-env.json");
}

function readNextEnvStore() {
  const file = nextEnvRecordPath();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    if (
      typeof parsed.repoRoot === "string" &&
      Object.hasOwn(parsed, "snapshot")
    ) {
      return { [canonicalPath(String(parsed.repoRoot))]: parsed };
    }
    const checkouts = parsed.checkouts;
    if (
      !checkouts ||
      typeof checkouts !== "object" ||
      Array.isArray(checkouts)
    ) {
      return {};
    }
    return checkouts;
  } catch {
    return {};
  }
}

function writeNextEnvStore(checkouts) {
  ensureDirs();
  writeFileSync(nextEnvRecordPath(), `${JSON.stringify({ checkouts })}\n`);
}

function readNextEnvRecord(root = repoRoot) {
  const record = readNextEnvStore()[canonicalPath(root)];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  return record;
}

function writeNextEnvRecord(root, record) {
  const checkouts = readNextEnvStore();
  checkouts[canonicalPath(root)] = record;
  writeNextEnvStore(checkouts);
}

function consumeNextEnvSnapshot(root = repoRoot) {
  const checkouts = readNextEnvStore();
  const key = canonicalPath(root);
  if (!Object.hasOwn(checkouts, key)) return false;
  delete checkouts[key];
  if (Object.keys(checkouts).length === 0) {
    unlinkSync(nextEnvRecordPath());
    return true;
  }
  writeNextEnvStore(checkouts);
  return true;
}

export function stripAgentRules(root = repoRoot) {
  const agentsPath = path.join(root, "AGENTS.md");
  if (!existsSync(agentsPath)) return false;
  const current = readFileSync(agentsPath, "utf8");
  const stripped = stripManagedBlocks(current);
  if (stripped === current) return false;
  writeFileSync(agentsPath, stripped);
  return true;
}

export function snapshotNextEnv(root = repoRoot) {
  ensureDirs();
  const existing = readNextEnvRecord(root);
  if (existing && Object.hasOwn(existing, "snapshot")) {
    return { ...existing, kept: true };
  }
  const source = path.join(root, "next-env.d.ts");
  const missing = !existsSync(source);
  const current = missing ? "" : readFileSync(source, "utf8");
  const record = {
    missing,
    snapshot: current,
  };
  writeNextEnvRecord(root, record);
  return record;
}

export function recordNextEnvWritten(root = repoRoot) {
  const record = readNextEnvRecord(root);
  if (!record || !Object.hasOwn(record, "snapshot")) return false;
  const source = path.join(root, "next-env.d.ts");
  record.writtenMissing = !existsSync(source);
  record.written = record.writtenMissing ? "" : readFileSync(source, "utf8");
  writeNextEnvRecord(root, record);
  return true;
}

export function restoreNextEnvSnapshot(root = repoRoot) {
  const record = readNextEnvRecord(root);
  if (!record || !Object.hasOwn(record, "snapshot")) {
    return {
      action: "left",
      warning:
        "cleanup: no snapshot of next-env.d.ts for this checkout. Leaving it unchanged.",
    };
  }
  if (!Object.hasOwn(record, "written")) {
    return {
      action: "left",
      warning:
        "cleanup: this run did not record the next-env.d.ts content it wrote. Leaving it unchanged.",
    };
  }
  const source = path.join(root, "next-env.d.ts");
  const currentMissing = !existsSync(source);
  const current = currentMissing ? "" : readFileSync(source, "utf8");
  const written = record.writtenMissing ? "" : String(record.written ?? "");
  if (
    currentMissing !== Boolean(record.writtenMissing) ||
    current !== written
  ) {
    consumeNextEnvSnapshot(root);
    return {
      action: "left",
      warning:
        "cleanup: next-env.d.ts is not the content this run wrote. Leaving it unchanged.",
    };
  }
  if (record.missing) {
    if (!currentMissing) unlinkSync(source);
  } else if (current !== record.snapshot) {
    writeFileSync(source, String(record.snapshot ?? ""));
  }
  consumeNextEnvSnapshot(root);
  return { action: "restored", warning: "" };
}

export function restoreTrackedDevFiles() {
  stripAgentRules();
}

export function agentEnvUnset() {
  return `unset ${agentEnvNames.join(" ")}`;
}

export async function checkHealth(baseUrl = defaultBaseUrl) {
  const lines = [];
  const { port, loopback } = baseUrlParts(baseUrl);
  const owned = ownsInstance();
  const nextHint = loopback && !owned ? formatForeignNext(port) : "";
  const timeoutMs = nextHint ? 1_500 : 8_000;
  const [home, about, privacy] = await Promise.all([
    fetchText(new URL("/", baseUrl).href, timeoutMs),
    fetchText(new URL("/about", baseUrl).href, timeoutMs),
    fetchText(new URL("/privacy", baseUrl).href, timeoutMs),
  ]);
  const homeOk = home.status === 200 && home.text.includes(homeMarker);
  const aboutOk = about.status === 200 && about.text.includes(aboutMarker);
  const privacyOk =
    privacy.status === 200 && privacy.text.includes(privacyMarker);
  const state = readState();
  if (state && !sameCheckout(state)) {
    lines.push(
      `doctor: run.json repo is ${state.repoRoot || "missing"}, this checkout is ${canonicalPath(repoRoot)}`,
    );
  }
  if (nextHint) lines.push(`doctor: ${nextHint}`);

  if (home.status === 0 && about.status === 0 && privacy.status === 0) {
    lines.push(`doctor: home unreachable (${home.error || "no response"})`);
    lines.push(
      nextHint
        ? "doctor: NOT_READY foreign-next"
        : "doctor: NOT_READY unreachable",
    );
    return {
      ok: false,
      code: nextHint ? "foreign-next" : "unreachable",
      lines,
      owned,
    };
  }

  lines.push(
    `doctor: home ${home.status || "down"}${homeOk ? " scan-box-present" : " scan-box-missing"}`,
  );
  lines.push(
    `doctor: about ${about.status || "down"}${aboutOk ? " title-present" : " title-missing"}`,
  );
  lines.push(
    `doctor: privacy ${privacy.status || "down"}${privacyOk ? " title-present" : " title-missing"}`,
  );
  lines.push(
    owned
      ? "doctor: fixture-mode recorded by verify:launch"
      : "doctor: fixture-mode unknown (verify:launch does not own this server)",
  );

  if (loopback) {
    const owners = portDetails(port);
    lines.push(
      owners
        ? `doctor: port ${port}\n${owners}`
        : `doctor: port ${port} owner-unknown`,
    );
  }

  if (homeOk && aboutOk && privacyOk && owned) {
    lines.push("doctor: READY");
    return { ok: true, code: "ready", lines, owned };
  }

  if (homeOk && aboutOk && privacyOk && !owned) {
    if (nextHint) {
      lines.push("doctor: NOT_READY foreign-next");
      return { ok: false, code: "foreign-next", lines, owned };
    }
    lines.push("doctor: NOT_READY foreign-server");
    return { ok: false, code: "foreign-server", lines, owned };
  }

  if (!homeOk) {
    lines.push("doctor: NOT_READY home-unhealthy");
    return { ok: false, code: "home-unhealthy", lines, owned };
  }

  if (!aboutOk) {
    lines.push("doctor: NOT_READY about-unhealthy");
    return { ok: false, code: "about-unhealthy", lines, owned };
  }

  lines.push("doctor: NOT_READY privacy-unhealthy");
  return { ok: false, code: "privacy-unhealthy", lines, owned };
}

export function tmuxCommand() {
  const conf = "/exec-daemon/tmux.portal.conf";
  return { bin: "tmux", prefix: existsSync(conf) ? ["-f", conf] : [] };
}

export function tmuxAvailable() {
  const found = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  return found.status === 0;
}

export function startTmuxSession(name, scriptBody) {
  const { bin, prefix } = tmuxCommand();
  ensureDirs();
  const scriptPath = path.join(stateDir, `${name}.sh`);
  writeFileSync(scriptPath, scriptBody, { mode: 0o755 });
  const logPath = path.join(stateDir, `${name}.log`);
  const wrapped = `#!/usr/bin/env bash
set -euo pipefail
cd ${shellQuote(repoRoot)}
exec bash ${shellQuote(scriptPath)} > ${shellQuote(logPath)} 2>&1
`;
  const wrappedPath = path.join(stateDir, `${name}.wrap.sh`);
  writeFileSync(wrappedPath, wrapped, { mode: 0o755 });
  const created = spawnSync(
    bin,
    [
      ...prefix,
      "new-session",
      "-d",
      "-s",
      name,
      "-c",
      repoRoot,
      "--",
      "bash",
      wrappedPath,
    ],
    { encoding: "utf8" },
  );
  if (created.status !== 0) {
    throw new Error(
      created.stderr || created.stdout || `tmux new-session ${name} failed`,
    );
  }
  rememberRun([name], { reused: false });
  return { logPath };
}

export function killTmuxSession(name) {
  const { bin, prefix } = tmuxCommand();
  const result = spawnSync(bin, [...prefix, "kill-session", "-t", name], {
    encoding: "utf8",
  });
  return result.status === 0;
}

export function sessionExists(name) {
  const { bin, prefix } = tmuxCommand();
  const result = spawnSync(bin, [...prefix, "has-session", "-t", name], {
    encoding: "utf8",
  });
  return result.status === 0;
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export function nodePathExport() {
  return `export PATH=${shellQuote(path.dirname(process.execPath))}:$PATH`;
}

export function runCommand(
  command,
  args,
  { timeoutMs = 120_000, env = process.env } = {},
) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: timeoutMs,
    env,
  });
}
