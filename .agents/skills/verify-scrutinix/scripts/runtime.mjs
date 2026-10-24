import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
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
export const defaultBaseUrl = "http://127.0.0.1:3000";

// One session name per checkout, so two checkouts never ask tmux for the same
// name. The name is still not ownership: cleanup checks the recorded identity.
const checkoutKey = createHash("sha256")
  .update(canonicalPath(repoRoot))
  .digest("hex")
  .slice(0, 10);

export const sessions = {
  next: `scrutinix-verify-next-${checkoutKey}`,
};

const homeMarker = "URL to analyze";
const aboutMarker = "How a scan becomes a verdict.";
// /privacy is anchored on structure, not copy: the heading is product copy and
// changes with disclosure edits. A rendered privacy page has the shared
// <main id="main-content"> shell, an <h1>, and the header Privacy link marked
// aria-current="page" (only true when the router pathname is /privacy).
export function privacyPageRendered(html) {
  if (!/<main\b[^>]*\bid="main-content"/.test(html)) return false;
  if (!/<h1\b/.test(html)) return false;
  const links = html.match(/<a\b[^>]*>/g) || [];
  return links.some(
    (tag) =>
      /\bhref="\/privacy"/.test(tag) && /\baria-current="page"/.test(tag),
  );
}

// Log excerpts carry whatever npm or the dev server printed, so every excerpt
// passes through here before it reaches a terminal or a CI log.
const redactions = [
  // Credentials in URLs: scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]+@/gi, "$1[redacted]@"],
  // Authorization schemes followed by a token
  [/\b(Bearer|Basic|Token)\s+[\w.~+/=-]{6,}/gi, "$1 [redacted]"],
  // Env-like assignments: NAME=value, export NAME="value"
  [/\b([A-Z][A-Z0-9_]+)=("[^"]*"|'[^']*'|\S*)/g, "$1=[redacted]"],
  // Secret-named keys in any case: api_key=..., "token": "...", sig=...
  [
    /\b((?:[\w-]*[_-])?(?:token|secret|password|passwd|pwd|api[_-]?key|apikey|auth|authorization|credentials?|cookie|sig|signature)s?)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s&,;]+)/gi,
    "$1$2[redacted]",
  ],
  // Well-known token shapes and JWTs
  [
    /\b(?:gh[pousr]_\w{20,}|github_pat_\w{20,}|sk-[\w-]{16,}|xox[abposr]-[\w-]{10,}|AKIA[0-9A-Z]{16}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})/g,
    "[redacted]",
  ],
  // Long hex strings
  [/\b[0-9a-f]{32,}\b/gi, "[redacted]"],
];

// Long opaque base64-like runs. A run is redacted when it, and its longest
// slash-separated piece (16+ characters), mix upper case, lower case, and
// digits. Paths split into short readable pieces and stay.
const opaqueRun = /[A-Za-z0-9+/_=-]{32,}/g;

function mixedCase(value) {
  return /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value);
}

function opaqueToken(run) {
  const longest = run
    .split("/")
    .reduce((best, piece) => (piece.length > best.length ? piece : best), "");
  return longest.length >= 16 && mixedCase(longest) && mixedCase(run);
}

export function redactSecrets(text) {
  let next = String(text);
  for (const [pattern, replacement] of redactions) {
    next = next.replace(pattern, replacement);
  }
  return next.replace(opaqueRun, (run) =>
    opaqueToken(run) ? "[redacted]" : run,
  );
}

export function logTail(file, bytes = 4000) {
  try {
    if (!existsSync(file)) return "";
    return redactSecrets(readFileSync(file, "utf8").slice(-bytes));
  } catch {
    return "";
  }
}

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

// --base-url, then E2E_BASE_URL, then the URL this checkout last launched on.
export function preferredBaseUrl() {
  if (process.env.E2E_BASE_URL) return process.env.E2E_BASE_URL;
  const state = readState();
  if (
    sameCheckout(state) &&
    typeof state.baseUrl === "string" &&
    state.baseUrl
  ) {
    return state.baseUrl;
  }
  return defaultBaseUrl;
}

// launch serves plain http on 127.0.0.1 only, on an explicit port.
export function launchableBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  const port = Number(url.port);
  return (
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    Number.isInteger(port) &&
    port >= 1024 &&
    port <= 65535
  );
}

export function baseUrlParts(baseUrl) {
  const url = new URL(baseUrl);
  return {
    url,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    loopback: url.hostname === "127.0.0.1" || url.hostname === "localhost",
  };
}

export function parseCliBaseUrl(argv = process.argv) {
  const index = argv.findIndex(
    (arg) => arg === "--base-url" || arg.startsWith("--base-url="),
  );
  if (index === -1) {
    return { ok: true, baseUrl: preferredBaseUrl(), message: "" };
  }
  const token = argv[index] ?? "";
  const raw = token.startsWith("--base-url=")
    ? token.slice("--base-url=".length)
    : argv[index + 1];
  if (typeof raw !== "string" || raw.trim() === "") {
    return {
      ok: false,
      baseUrl: "",
      message: "--base-url needs a URL, such as http://127.0.0.1:3000",
    };
  }
  try {
    new URL(raw);
  } catch {
    return {
      ok: false,
      baseUrl: "",
      message: `--base-url ${JSON.stringify(raw)} is not a valid URL. Use http://127.0.0.1:<port>`,
    };
  }
  return { ok: true, baseUrl: raw, message: "" };
}

export function foreignNextStopHint(port) {
  return `find the listener pid with lsof -nP -iTCP:${port} -sTCP:LISTEN -t, or ss -ltnp 'sport = :${port}' on Linux. Check its start time and executable with ps -o pid=,lstart=,comm= -p <pid> and its working directory with lsof -a -p <pid> -d cwd -Fn (readlink /proc/<pid>/cwd on Linux). Stop that exact pid with kill <pid> only when all three are the server you mean. Do not kill by name or pattern.`;
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

function validPid(pid) {
  return Number.isInteger(pid) && pid > 0;
}

// ps and lsof resolve from the system directories first, so neither an empty
// PATH nor a shadowing binary earlier on PATH changes what identity reads.
function systemTool(name) {
  for (const dir of ["/usr/sbin", "/usr/bin", "/bin", "/sbin"]) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}

// Runs a read-only probe. Returns null when the tool is missing or fails, and
// never lets its stderr reach the terminal.
function probe(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, LC_ALL: "C" },
    });
  } catch {
    return null;
  }
}

function safeReadlink(file) {
  try {
    return readlinkSync(file);
  } catch {
    return "";
  }
}

function listenerPidsFromProc(port) {
  const inodes = listenInodes(port);
  if (!inodes.size) return [];
  const pids = new Set();
  let dirents = [];
  try {
    dirents = readdirSync("/proc");
  } catch {
    return [];
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
      const target = safeReadlink(`/proc/${dirent}/fd/${fd}`);
      if (target.startsWith("socket:[") && inodes.has(target.slice(8, -1))) {
        pids.add(Number(dirent));
      }
    }
  }
  return [...pids];
}

export function parseListenerPids(details) {
  const pids = new Set();
  for (const match of String(details).matchAll(/\bpid(?:=|\s+)(\d+)/g)) {
    const pid = Number(match[1]);
    if (validPid(pid)) pids.add(pid);
  }
  return [...pids];
}

// ss on Linux, /proc when ss is missing, lsof everywhere else (macOS).
export function listenerPids(port) {
  const fromSs = probe("ss", ["-ltnp", `sport = :${port}`]);
  if (fromSs !== null && parseListenerPids(fromSs).length) {
    return parseListenerPids(fromSs);
  }
  if (existsSync("/proc/net/tcp")) return listenerPidsFromProc(port);
  const fromLsof = probe(systemTool("lsof"), [
    "-nP",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
    "-t",
  ]);
  if (!fromLsof) return [];
  return [...new Set(fromLsof.split("\n").map(Number).filter(validPid))];
}

// The identity cleanup compares before it signals a pid: the pid, when that
// process started, its executable, and the directory it serves. A reused pid
// has a different start time; another checkout's server has a different cwd.
// None of these is a command line, so diagnostics may print them.
export function processIdentity(pid) {
  if (!validPid(pid)) return null;
  if (existsSync("/proc/self/stat")) {
    let stat = "";
    try {
      stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    } catch {
      return null;
    }
    // Field 22 is starttime in clock ticks since boot. The comm field can
    // hold spaces, so count from the last ")".
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ticks = fields[19] ?? "";
    return {
      pid,
      startTime: ticks ? `boot+${ticks}ticks` : "",
      executable: safeReadlink(`/proc/${pid}/exe`),
      cwd: safeReadlink(`/proc/${pid}/cwd`),
    };
  }
  const ps = systemTool("ps");
  const started = probe(ps, ["-o", "lstart=", "-p", String(pid)])?.trim();
  if (!started) return null;
  // lsof -F prints one "f<descriptor>" line before each "n<path>" line. The
  // first txt entry is the executable image; cwd is the working directory.
  const files = {};
  let descriptor = "";
  const listing =
    probe(systemTool("lsof"), [
      "-a",
      "-p",
      String(pid),
      "-d",
      "cwd,txt",
      "-Fn",
    ]) ?? "";
  for (const line of listing.split("\n")) {
    if (line.startsWith("f")) descriptor = line.slice(1);
    if (line.startsWith("n") && descriptor && !(descriptor in files)) {
      files[descriptor] = line.slice(1);
    }
  }
  return {
    pid,
    startTime: started.replace(/\s+/g, " "),
    executable:
      files.txt ?? probe(ps, ["-o", "comm=", "-p", String(pid)])?.trim() ?? "",
    cwd: files.cwd ?? "",
  };
}

export function describeProcess(identity) {
  return `pid ${identity.pid}, started ${identity.startTime || "unknown"}, executable ${identity.executable || "unknown"}, cwd ${identity.cwd || "unknown"}`;
}

// Why a recorded process is no longer the one this checkout started, or ""
// when every field still matches. `fields` lets the tmux pane skip the
// executable: its bash wrapper execs npm, which changes the binary but not
// the pid, start time, or cwd.
export function identityProblem(
  recorded,
  current,
  { root = repoRoot, fields = ["startTime", "executable", "cwd"] } = {},
) {
  if (!recorded || typeof recorded !== "object" || !validPid(recorded.pid)) {
    return "no recorded process identity (pid, start time, executable, cwd)";
  }
  const pid = recorded.pid;
  for (const field of fields) {
    if (typeof recorded[field] !== "string" || recorded[field] === "") {
      return `pid ${pid} was recorded without its ${field}`;
    }
  }
  if (!current) return `pid ${pid} is no longer running`;
  if (current.pid !== pid) return `pid ${current.pid} is not pid ${pid}`;
  if (
    fields.includes("startTime") &&
    current.startTime !== recorded.startTime
  ) {
    return `pid ${pid} started ${current.startTime || "at an unknown time"}, not ${recorded.startTime}, so the pid was reused`;
  }
  if (
    fields.includes("executable") &&
    current.executable !== recorded.executable
  ) {
    return `pid ${pid} runs ${current.executable || "an unknown executable"}, not ${recorded.executable}`;
  }
  if (fields.includes("cwd")) {
    const checkout = canonicalPath(root);
    if (
      !current.cwd ||
      canonicalPath(current.cwd) !== canonicalPath(recorded.cwd)
    ) {
      return `pid ${pid} serves ${current.cwd || "an unknown directory"}, not ${recorded.cwd}`;
    }
    if (canonicalPath(recorded.cwd) !== checkout) {
      return `pid ${pid} serves ${recorded.cwd}, which is not this checkout (${checkout})`;
    }
  }
  return "";
}

// Signal one recorded process only when its identity still matches.
export function stopRecordedProcess(recorded, { root = repoRoot } = {}) {
  const pid =
    recorded && typeof recorded === "object" ? recorded.pid : recorded;
  if (!validPid(pid)) {
    return {
      action: "refused",
      message: `refused ${JSON.stringify(recorded)}: not a pid`,
    };
  }
  const current = processIdentity(pid);
  if (!current)
    return { action: "gone", message: `pid ${pid} was already gone` };
  const problem = identityProblem(recorded, current, { root });
  if (problem) {
    return {
      action: "refused",
      message: `refused to stop pid ${pid}: ${problem}`,
    };
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return { action: "gone", message: `pid ${pid} was already gone` };
  }
  return { action: "stopped", message: `sent SIGTERM to pid ${pid}` };
}

export function portDetails(port) {
  return listenerPids(port)
    .map((pid) => {
      const identity = processIdentity(pid);
      return identity ? describeProcess(identity) : `pid ${pid}`;
    })
    .join("\n");
}

export function isNextDevCommand(command) {
  if (!command) return false;
  if (command.includes("next-server")) return true;
  return /(^|[/\s])next(?=\s|$)/.test(command);
}

// Read only to classify a listener as next dev. Never printed: a command line
// can carry tokens.
function commandLine(pid) {
  if (!validPid(pid)) return "";
  if (existsSync("/proc/self/cmdline")) {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, "utf8")
        .replaceAll("\0", " ")
        .trim();
    } catch {
      return "";
    }
  }
  return (
    probe(systemTool("ps"), ["-o", "command=", "-p", String(pid)])?.trim() ?? ""
  );
}

export function foreignNextListeners(port) {
  const found = [];
  for (const pid of listenerPids(port)) {
    if (!isNextDevCommand(commandLine(pid))) continue;
    found.push({ pid, cwd: processIdentity(pid)?.cwd ?? "" });
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

// Listeners on the port that serve this checkout, with their identity.
export function checkoutListeners(port, root = repoRoot) {
  const checkout = canonicalPath(root);
  return listenerPids(port)
    .map((pid) => processIdentity(pid))
    .filter(
      (identity) =>
        identity !== null &&
        identity.cwd !== "" &&
        canonicalPath(identity.cwd) === checkout,
    );
}

// A tmux session is identified by its server-assigned id, its creation time,
// and its pane process. A name is not ownership: anyone can create a session
// with the same name after ours ends.
// Fields are joined with ":", which tmux forbids in session names. Older tmux
// (3.3) rewrites a tab in -F output as "_", so a tab separator is unsafe.
export function tmuxSessionIdentity(name) {
  const { bin, prefix } = tmuxCommand();
  const listed = spawnSync(
    bin,
    [
      ...prefix,
      "list-sessions",
      "-F",
      "#{session_name}:#{session_id}:#{session_created}:#{pane_pid}",
    ],
    { encoding: "utf8" },
  );
  if (listed.status !== 0) return null;
  for (const line of listed.stdout.split("\n")) {
    const [sessionName, id, created, panePid] = line.split(":");
    if (sessionName === name && id && created) {
      return { name, id, created, panePid: Number(panePid) };
    }
  }
  return null;
}

const paneFields = ["startTime", "cwd"];

// Why a recorded session is not the one this checkout started, "" when it
// still is. `gone` is set when no session of that name exists.
export function sessionProblem(recorded, { root = repoRoot } = {}) {
  if (!recorded || typeof recorded !== "object") {
    return {
      gone: false,
      problem: `${JSON.stringify(recorded)} was recorded by name only, and a session name is not ownership`,
    };
  }
  const current = tmuxSessionIdentity(recorded.name);
  if (!current) return { gone: true, problem: "" };
  // A tmux server that restarts numbers sessions from $0 again, and creation
  // time has one-second resolution, so the pane pid is part of the identity.
  const recordedPanePid = recorded.pane?.pid;
  if (
    current.id !== recorded.id ||
    current.created !== recorded.created ||
    current.panePid !== recordedPanePid
  ) {
    return {
      gone: false,
      problem: `tmux session ${recorded.name} is now ${current.id} created ${current.created} with pane pid ${current.panePid}, not ${recorded.id} created ${recorded.created} with pane pid ${recordedPanePid ?? "unknown"}, so the name was reused`,
    };
  }
  const pane = processIdentity(current.panePid);
  const paneIssue = identityProblem(recorded.pane, pane, {
    root,
    fields: paneFields,
  });
  if (paneIssue) {
    return {
      gone: false,
      problem: `tmux session ${recorded.name} pane: ${paneIssue}`,
    };
  }
  return { gone: false, problem: "", current };
}

// Kill one recorded tmux session, by its id, only when it is still ours.
export function stopRecordedSession(recorded, { root = repoRoot } = {}) {
  const label =
    recorded && typeof recorded === "object" ? recorded.name : recorded;
  const { gone, problem, current } = sessionProblem(recorded, { root });
  if (gone) {
    return {
      action: "gone",
      message: `tmux session ${label} was already gone`,
    };
  }
  if (problem) {
    return {
      action: "refused",
      message: `refused to stop tmux session ${label}: ${problem}`,
    };
  }
  const { bin, prefix } = tmuxCommand();
  const killed = spawnSync(bin, [...prefix, "kill-session", "-t", current.id], {
    encoding: "utf8",
  });
  return killed.status === 0
    ? {
        action: "stopped",
        message: `stopped tmux session ${label} (${current.id})`,
      }
    : { action: "failed", message: `failed to stop tmux session ${label}` };
}

function recordedSession(state, name) {
  const list = Array.isArray(state?.sessions) ? state.sessions : [];
  return (
    list.find(
      (entry) => entry && typeof entry === "object" && entry.name === name,
    ) ?? null
  );
}

export function ownedSession(state = readState()) {
  if (!sameCheckout(state)) return null;
  const recorded = recordedSession(state, sessions.next);
  if (!recorded) return null;
  const { gone, problem } = sessionProblem(recorded);
  return gone || problem ? null : recorded;
}

export function ownsInstance() {
  return ownedSession() !== null;
}

// Another checkout's run is live when its recorded session still matches, or
// a listener on the port serves that checkout's directory.
export function foreignRunLive(state, port) {
  if (!state || sameCheckout(state) || typeof state.repoRoot !== "string") {
    return false;
  }
  const sessionsList = Array.isArray(state.sessions) ? state.sessions : [];
  const liveSession = sessionsList.some((entry) => {
    const { gone, problem } = sessionProblem(entry, { root: state.repoRoot });
    return !gone && !problem;
  });
  return liveSession || checkoutListeners(port, state.repoRoot).length > 0;
}

export function rememberRun(started, extra = {}) {
  const previous = readState();
  const base = previous && sameCheckout(previous) ? previous : null;
  const byName = new Map();
  for (const entry of [
    ...(Array.isArray(base?.sessions) ? base.sessions : []),
    ...started,
  ]) {
    if (entry && typeof entry === "object" && typeof entry.name === "string") {
      byName.set(entry.name, entry);
    }
  }
  writeState({
    baseUrl: extra.baseUrl || base?.baseUrl || defaultBaseUrl,
    evidenceDir,
    repoRoot: canonicalPath(repoRoot),
    sessions: [...byName.values()],
    listeners:
      extra.listeners ?? (Array.isArray(base?.listeners) ? base.listeners : []),
    fixtureMode: true,
    reused: extra.reused ?? started.length === 0,
    startedAt: base?.startedAt || new Date().toISOString(),
  });
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
    rmSync(nextEnvRecordPath(), { force: true });
    return true;
  }
  writeNextEnvStore(checkouts);
  return true;
}

export function hasNextEnvRecord() {
  return existsSync(nextEnvRecordPath());
}

function fileMatchesRecord(missing, current, recordMissing, recorded) {
  if (missing !== Boolean(recordMissing)) return false;
  if (missing) return true;
  return current === String(recorded ?? "");
}

function saveSnapshotCopy(record) {
  ensureDirs();
  const dest = path.join(
    evidenceDir,
    `next-env-${Date.now().toString(36)}.snapshot`,
  );
  writeFileSync(dest, String(record.snapshot ?? ""));
  return dest;
}

export function snapshotNextEnv(root = repoRoot) {
  ensureDirs();
  const source = path.join(root, "next-env.d.ts");
  const missing = !existsSync(source);
  const current = missing ? "" : readFileSync(source, "utf8");
  const existing = readNextEnvRecord(root);
  if (existing && Object.hasOwn(existing, "snapshot")) {
    const matchesSnapshot = fileMatchesRecord(
      missing,
      current,
      existing.missing,
      existing.snapshot,
    );
    const matchesWritten =
      Object.hasOwn(existing, "written") &&
      fileMatchesRecord(
        missing,
        current,
        existing.writtenMissing,
        existing.written,
      );
    if (matchesSnapshot || matchesWritten) {
      return { ...existing, kept: true };
    }
    consumeNextEnvSnapshot(root);
  }
  const record = {
    missing,
    snapshot: current,
  };
  writeNextEnvRecord(root, record);
  if (existing && Object.hasOwn(existing, "snapshot")) {
    return {
      ...record,
      dropped: true,
      warning:
        "launch: next-env.d.ts does not match the saved snapshot or the recorded write. Dropping the old snapshot.",
    };
  }
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
  const source = path.join(root, "next-env.d.ts");
  const currentMissing = !existsSync(source);
  const current = currentMissing ? "" : readFileSync(source, "utf8");
  if (!Object.hasOwn(record, "written")) {
    const differs = !fileMatchesRecord(
      currentMissing,
      current,
      record.missing,
      record.snapshot,
    );
    const backup = differs ? saveSnapshotCopy(record) : "";
    consumeNextEnvSnapshot(root);
    return {
      action: "left",
      warning: backup
        ? `cleanup: this run did not record the next-env.d.ts content it wrote. Leaving it unchanged. Snapshot saved to ${backup}`
        : "cleanup: this run did not record the next-env.d.ts content it wrote. Leaving it unchanged. Dropped the unfinished snapshot.",
    };
  }
  const written = record.writtenMissing ? "" : String(record.written ?? "");
  if (
    currentMissing !== Boolean(record.writtenMissing) ||
    current !== written
  ) {
    const backup = saveSnapshotCopy(record);
    consumeNextEnvSnapshot(root);
    return {
      action: "left",
      warning: `cleanup: next-env.d.ts is not the content this run wrote. Leaving it unchanged. Snapshot saved to ${backup}`,
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
  const privacyOk = privacy.status === 200 && privacyPageRendered(privacy.text);
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
    `doctor: privacy ${privacy.status || "down"}${privacyOk ? " page-present" : " page-missing"}`,
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
      "-P",
      "-F",
      "#{session_id}:#{session_created}:#{pane_pid}",
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
  // -P prints the identity of the session this call created, so the record
  // can never describe a same-named session someone else made.
  const [id = "", createdAt = "", panePid = ""] = created.stdout
    .trim()
    .split(":");
  const session = {
    name,
    id,
    created: createdAt,
    pane: processIdentity(Number(panePid)),
  };
  rememberRun([session], { reused: false });
  return { logPath, session };
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
