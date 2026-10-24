import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(scriptDir, "../../../..");
export const skillDir = path.resolve(scriptDir, "..");
// Resolved once, so the path every check validates is the path every later
// open uses.
export const stateDir = path.resolve(
  process.env.VERIFY_STATE_DIR || "/tmp/scrutinix-verify",
);
export const evidenceDir = path.resolve(
  process.env.VERIFY_EVIDENCE_DIR || path.join(stateDir, "evidence"),
);
export const stateFile = path.join(stateDir, "run.json");
export const defaultPort = 3000;
export const supervisorScript = path.join(scriptDir, "supervisor.mjs");
export const stateVersion = 2;

const uid = typeof process.getuid === "function" ? process.getuid() : null;

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

// ---- Redaction --------------------------------------------------------------

// Log excerpts carry whatever npm or the dev server printed, so every excerpt
// passes through redactSecrets before it reaches a terminal or a CI log.
// Diagnostics otherwise print selected fields only (pid, start time,
// executable, cwd), never a command line or an environment.

// Key words that mark a value as secret. Strong words match anywhere in the
// key (accessToken, X_API_KEY, clientSecret); weak words only as a whole word
// of the key, so "author" or "signal" stay readable.
const strongSecretWords =
  /token|secret|passw|apikey|accesskey|privatekey|credential|cookie|signature|bearer/;
const weakSecretWords = new Set([
  "auth",
  "authorization",
  "key",
  "keys",
  "pass",
  "pwd",
  "sig",
  "session",
  "dsn",
  "private",
]);

function decodeKey(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function secretKey(raw) {
  const key = decodeKey(String(raw));
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (strongSecretWords.test(words.join(""))) return true;
  return words.some((word) => weakSecretWords.has(word));
}

function envKey(raw) {
  return /^[A-Z][A-Z0-9_]+$/.test(decodeKey(String(raw)));
}

// A key, optionally quoted (or \"escaped\" inside a JSON string), a ":" or
// "=", and a value. Percent-encoded keys (%74oken) are decoded before the
// secret test.
const keyChars = String.raw`(?:[A-Za-z0-9_.-]|%[0-9A-Fa-f]{2})+`;
const keyQuote = String.raw`(?:\\?["'])?`;
const pairValue = [
  String.raw`"(?:[^"\\]|\\[\s\S])*"`, // "double", escape-aware
  String.raw`'(?:[^'\\]|\\[\s\S])*'`, // 'single', escape-aware
  String.raw`\\"(?:[^"\\]|\\(?!")[\s\S])*\\"`, // \"escaped\" in a JSON string
  String.raw`[|>][-+]?[ \t]*(?:\r?\n[ \t]+[^\r\n]*)+`, // YAML block scalar
  String.raw`(?=\r?\n[ \t])(?:\r?\n[ \t]+[^\r\n]*)+`, // empty, then indented lines
  String.raw`(?:\\\r?\n[ \t]*|[^\s&,;}\])])+`, // unquoted, with "\" continuations
].join("|");
const pairPattern = new RegExp(
  String.raw`(?<![A-Za-z0-9_%\\])(${keyQuote}(${keyChars})${keyQuote}[ \t]*[:=][ \t]*)(${pairValue})`,
  "g",
);

function maskValue(value) {
  for (const quote of ['\\"', '"', "'"]) {
    if (value.startsWith(quote) && value.length >= quote.length * 2) {
      return `${quote}[redacted]${quote}`;
    }
  }
  return "[redacted]";
}

function redactPairs(text) {
  return text.replace(pairPattern, (match, head, key, value) => {
    if (value.startsWith("[redacted")) return match;
    if (secretKey(key) || (head.includes("=") && envKey(key))) {
      return `${head}${maskValue(value)}`;
    }
    // Not a secret key, but its value can still hold one ("msg": "token=…").
    return `${head}${redactPairs(value)}`;
  });
}

const redactions = [
  // PEM blocks, including an unterminated one at the end of the text
  [
    /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g,
    "[redacted PEM block]",
  ],
  // Credentials in URLs: scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]+@/gi, "$1[redacted]@"],
  // Authorization schemes followed by a token
  [/\b(Bearer|Basic|Token)\s+[\w.~+/=-]{6,}/gi, "$1 [redacted]"],
  // Flags: --token VALUE, --password VALUE
  [
    /(\s--?[\w-]*(?:token|secret|password|passwd|api-?key)[\w-]*[ \t]+)(?!-)(\S+)/gi,
    "$1[redacted]",
  ],
];

const tokenShapes = [
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
  next = redactPairs(next);
  // Header lines whose name is secret-like: the rest of the line is the value
  // (Cookie: a=1; sid=…). A block scalar already redacted is left as it is.
  next = next.replace(
    /^([ \t]*[\w-]*(?:authorization|cookie|token|secret|api-key|password)[\w-]*[ \t]*:[ \t]*)(?!\[redacted\]$)(\S.*)$/gim,
    "$1[redacted]",
  );
  for (const [pattern, replacement] of tokenShapes) {
    next = next.replace(pattern, replacement);
  }
  return next.replace(opaqueRun, (run) =>
    opaqueToken(run) ? "[redacted]" : run,
  );
}

const logReadLimit = 32 * 1024 * 1024;

// The last whole lines of a log, at most `chars` characters. The whole file is
// redacted first, so a secret split by the cut can never show its value.
export function logTail(file, chars = 4000) {
  let text = "";
  try {
    if (!existsSync(file)) return "";
    if (statSync(file).size > logReadLimit) {
      return `[log larger than ${logReadLimit} bytes. Not excerpted.]`;
    }
    text = readFileSync(file, "utf8");
  } catch {
    return "";
  }
  const lines = redactSecrets(text).replace(/\s+$/, "").split("\n");
  const kept = [];
  let length = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (length + line.length + 1 > chars) {
      if (!kept.length) kept.unshift(line.slice(-chars));
      break;
    }
    kept.unshift(line);
    length += line.length + 1;
  }
  return kept.join("\n");
}

// ---- Paths and the private state directory ----------------------------------

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

function trustedOwner(owner) {
  return uid === null || owner === uid || owner === 0;
}

// A directory nobody else can change entries in: owned by root or this user,
// and writable by group or others only when sticky (/tmp), where nobody can
// rename or remove an entry they do not own.
function directoryProblem(dir) {
  let stat;
  try {
    stat = lstatSync(dir);
  } catch {
    return `${dir} cannot be read`;
  }
  if (!stat.isDirectory()) return `${dir} is not a directory`;
  if (!trustedOwner(stat.uid)) return `${dir} is owned by uid ${stat.uid}`;
  if ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0) {
    return `${dir} is writable by group or others and is not sticky`;
  }
  return "";
}

const maxSymlinks = 40;

// Nobody else may be able to swap the directory out. The path is resolved one
// component at a time, the way the kernel does: every directory an entry is
// looked up in must pass directoryProblem, every entry on the way (symlinks
// included) must belong to root or this user, and a symlink's target is
// resolved the same way, so a link in a swappable directory, or one leading
// through one, is refused. Components that do not exist yet are fine: they
// are created later, mode 0700, under a directory that passed.
function ancestorProblem(dir) {
  const pending = path.resolve(dir).split("/").filter(Boolean);
  let current = "/";
  let links = 0;
  while (pending.length) {
    const name = pending.shift() ?? "";
    if (name === ".") continue;
    if (name === "..") {
      current = path.dirname(current);
      continue;
    }
    const problem = directoryProblem(current);
    if (problem) return problem;
    const entry = path.join(current, name);
    let stat;
    try {
      stat = lstatSync(entry);
    } catch {
      return "";
    }
    if (!trustedOwner(stat.uid)) {
      return `${entry} is ${stat.isSymbolicLink() ? "a symlink " : ""}owned by uid ${stat.uid}`;
    }
    if (stat.isSymbolicLink()) {
      links += 1;
      if (links > maxSymlinks) return `${dir} has too many symlinks`;
      const target = readlinkSync(entry);
      if (target.startsWith("/")) current = "/";
      pending.unshift(...target.split("/").filter(Boolean));
      continue;
    }
    current = entry;
  }
  return "";
}

// Why `dir` is not safe to read actionable state from, or "" when it is: a
// real directory, owned by this user, mode 0700, under safe ancestors.
export function privateDirProblem(dir) {
  let stat;
  try {
    stat = lstatSync(dir);
  } catch {
    return `${dir} does not exist`;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return `${dir} must be a real directory owned by this user with mode 0700`;
  }
  if (uid !== null && stat.uid !== uid) {
    return `${dir} is owned by uid ${stat.uid}, expected ${uid}`;
  }
  const mode = stat.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    return `${dir} is group or world accessible (mode 0${mode.toString(8)})`;
  }
  return ancestorProblem(dir);
}

export class UnsafeStateError extends Error {}

function assertPrivateDir(dir) {
  const problem = privateDirProblem(dir);
  if (problem) {
    throw new UnsafeStateError(
      `verify: ${problem}. Refusing to use it for verify state.`,
    );
  }
}

// Create (0700) or validate the state and evidence directories for writing.
export function ensureDirs(dirs = [stateDir, evidenceDir]) {
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      // Nothing is created under a path someone else could swap.
      const problem = ancestorProblem(dir);
      if (problem) {
        throw new UnsafeStateError(
          `verify: ${problem}. Refusing to use it for verify state.`,
        );
      }
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
    }
    assertPrivateDir(dir);
  }
}

// Read a state file only when it is a regular file owned by this user that
// nobody else can write, and never through a symlink. null when missing.
export function readPrivateFile(file) {
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error?.code === "ELOOP" || error?.code === "EMLINK") {
      throw new UnsafeStateError(`verify: ${file} is a symlink. Refusing it.`);
    }
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      throw new UnsafeStateError(`verify: ${file} is not a regular file.`);
    }
    if (uid !== null && stat.uid !== uid) {
      throw new UnsafeStateError(
        `verify: ${file} is owned by uid ${stat.uid}, expected ${uid}.`,
      );
    }
    if ((stat.mode & 0o022) !== 0) {
      throw new UnsafeStateError(
        `verify: ${file} is writable by group or others (mode 0${(stat.mode & 0o777).toString(8)}).`,
      );
    }
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

// Write a state file atomically with mode 0600, after validating its directory.
export function writePrivateFile(file, content) {
  ensureDirs([path.dirname(file)]);
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const fd = openSync(
    temp,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, content);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, file);
}

// The recorded run, read only after the state directory and run.json pass
// every check. `problem` explains a refusal; nothing in an unsafe directory is
// parsed, let alone acted on.
export function loadState(dir = stateDir) {
  if (!existsSync(dir)) return { state: null, problem: "", missingDir: true };
  const problem = privateDirProblem(dir);
  if (problem) return { state: null, problem };
  let text;
  try {
    text = readPrivateFile(path.join(dir, "run.json"));
  } catch (error) {
    return {
      state: null,
      problem: error instanceof Error ? error.message : String(error),
    };
  }
  if (text === null) return { state: null, problem: "" };
  try {
    const state = JSON.parse(text);
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return { state: null, problem: "run.json is not a JSON object" };
    }
    return { state, problem: "" };
  } catch {
    return { state: null, problem: "run.json is not valid JSON" };
  }
}

export function readState(dir = stateDir) {
  return loadState(dir).state;
}

export function writeState(state, dir = stateDir) {
  writePrivateFile(
    path.join(dir, "run.json"),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

// A run.json from the tmux version of this skill: it recorded sessions and
// listener identities, which this version never signals.
export function legacyState(state) {
  return (
    Boolean(state) &&
    state.version !== stateVersion &&
    (Array.isArray(state.sessions) ||
      Array.isArray(state.listeners) ||
      Array.isArray(state.pids))
  );
}

export function legacyPids(state) {
  const pids = [];
  for (const entry of [
    ...(Array.isArray(state?.listeners) ? state.listeners : []),
    ...(Array.isArray(state?.pids) ? state.pids : []),
    ...(Array.isArray(state?.sessions)
      ? state.sessions.map((session) => session?.pane)
      : []),
  ]) {
    const pid = typeof entry === "object" && entry ? entry.pid : entry;
    if (validPid(pid)) pids.push(pid);
  }
  return [...new Set(pids)];
}

// ---- Ports ------------------------------------------------------------------

// Every command serves or probes http://127.0.0.1:<port> and takes only the
// port, an integer. No argument is a URL, so none can carry a user name,
// password, or token, and npm's script banner (which echoes the arguments)
// never shows one. Errors never echo the input.

export function validPort(port) {
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

export function baseUrlFor(port) {
  return `http://127.0.0.1:${port}`;
}

// The port this checkout last launched on, else the default.
export function preferredPort() {
  const state = readState();
  if (
    state &&
    !legacyState(state) &&
    sameCheckout(state) &&
    validPort(state.port)
  ) {
    return state.port;
  }
  return defaultPort;
}

// Reads --port <n> or --port=<n>, and the boolean `flags` this command
// takes. With `rest`, other arguments are returned for the caller to pass
// on (smoke passes them to Playwright); without it, they are refused.
export function parseCliArgs(
  argv = process.argv.slice(2),
  { flags = [], rest = false } = {},
) {
  const fail = (message) => ({ ok: false, message });
  let raw = null;
  const set = new Set();
  const others = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--base-url" || arg.startsWith("--base-url=")) {
      return fail(
        "--base-url is not supported. Use --port <n>; the base URL is always http://127.0.0.1:<port>",
      );
    }
    if (arg === "--port" || arg.startsWith("--port=")) {
      if (raw !== null) return fail("--port was given more than once");
      raw = arg === "--port" ? (argv[(index += 1)] ?? "") : arg.slice(7);
      continue;
    }
    if (flags.includes(arg)) {
      set.add(arg);
      continue;
    }
    if (rest) {
      others.push(arg);
      continue;
    }
    return fail("got an argument it does not take. See --help");
  }
  if (raw === null) {
    return { ok: true, port: preferredPort(), flags: set, rest: others };
  }
  const port = /^[0-9]{1,5}$/.test(raw) ? Number(raw) : NaN;
  if (!validPort(port)) {
    return fail("--port needs an integer from 1024 to 65535");
  }
  return { ok: true, port, flags: set, rest: others };
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

// A fetch failure is reported as a code, never as the error message: undici
// messages can repeat the URL.
async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: { Accept: "text/html" },
    });
    const text = await response.text();
    return { status: response.status, text, error: "" };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    const code = error?.cause?.code;
    return {
      status: 0,
      text: "",
      error: aborted
        ? "timeout"
        : typeof code === "string" && /^[A-Z_]+$/.test(code)
          ? code
          : "request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---- Processes and listeners ------------------------------------------------

function validPid(pid) {
  return Number.isInteger(pid) && pid > 0;
}

const onLinux = existsSync("/proc/self/stat");

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

// Fields after the ")" that closes comm in /proc/<pid>/stat: state, ppid,
// pgrp, session, ... The comm field can hold spaces, so count from the last ")".
function procStat(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  } catch {
    return null;
  }
}

function hexAddress(hex) {
  if (hex.length === 8) {
    return (hex.match(/../g) ?? [])
      .reverse()
      .map((byte) => Number.parseInt(byte, 16))
      .join(".");
  }
  // IPv6: four little-endian 32-bit words.
  const bytes = (hex.match(/.{8}/g) ?? []).flatMap((word) =>
    (word.match(/../g) ?? []).reverse(),
  );
  if (bytes.slice(0, 10).every((byte) => byte === "00")) {
    if (bytes[10] === "FF" && bytes[11] === "FF") {
      return `::ffff:${bytes
        .slice(12)
        .map((byte) => Number.parseInt(byte, 16))
        .join(".")}`;
    }
  }
  return `[${bytes.join("").toLowerCase()}]`;
}

function procListenSockets(port) {
  const sockets = new Map();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let lines = [];
    try {
      lines = readFileSync(file, "utf8").split("\n").slice(1);
    } catch {
      continue;
    }
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      const [addressHex, portHex] = (parts[1] ?? "").split(":");
      if (!addressHex || !portHex || parts[3] !== "0A" || !parts[9]) continue;
      if (Number.parseInt(portHex, 16) !== port) continue;
      sockets.set(parts[9], hexAddress(addressHex));
    }
  }
  return sockets;
}

function procListeners(port) {
  const sockets = procListenSockets(port);
  if (!sockets.size) return [];
  const found = [];
  const attributed = new Set();
  let dirents = [];
  try {
    dirents = readdirSync("/proc");
  } catch {
    dirents = [];
  }
  for (const dirent of dirents) {
    if (!/^\d+$/.test(dirent)) continue;
    let fds = [];
    try {
      fds = readdirSync(`/proc/${dirent}/fd`);
    } catch {
      continue;
    }
    const seen = new Set();
    for (const fd of fds) {
      const target = safeReadlink(`/proc/${dirent}/fd/${fd}`);
      if (!target.startsWith("socket:[")) continue;
      const inode = target.slice(8, -1);
      if (!sockets.has(inode) || seen.has(inode)) continue;
      seen.add(inode);
      attributed.add(inode);
      found.push({ pid: Number(dirent), address: sockets.get(inode) });
    }
  }
  // A socket no readable process holds (another user's) still counts.
  for (const [inode, address] of sockets) {
    if (!attributed.has(inode)) found.push({ pid: null, address });
  }
  return found;
}

function lsofListeners(port) {
  const listing = probe(systemTool("lsof"), [
    "-nP",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
    "-Fpn",
  ]);
  if (!listing) return [];
  const found = [];
  let pid = null;
  for (const line of listing.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    if (line.startsWith("n") && validPid(pid)) {
      const name = line.slice(1);
      const host = name.slice(0, name.lastIndexOf(":"));
      found.push({ pid, address: host.replace(/^\[(.*)\]$/, "$1") });
    }
  }
  return found;
}

// Every listening socket on the port, with the pid that holds it (null when
// no process this user can read holds it) and its local address.
export function portListeners(port) {
  return onLinux ? procListeners(port) : lsofListeners(port);
}

export function listenerPids(port) {
  return [
    ...new Set(
      portListeners(port)
        .map((listener) => listener.pid)
        .filter(validPid),
    ),
  ];
}

export function processGroup(pid) {
  if (!validPid(pid)) return null;
  if (onLinux) {
    const fields = procStat(pid);
    const pgid = Number(fields?.[2]);
    return validPid(pgid) ? pgid : null;
  }
  const pgid = Number(
    probe(systemTool("ps"), ["-o", "pgid=", "-p", String(pid)])?.trim(),
  );
  return validPid(pgid) ? pgid : null;
}

// Live (not zombie) members of a process group.
export function processGroupMembers(pgid) {
  const members = [];
  if (onLinux) {
    let dirents = [];
    try {
      dirents = readdirSync("/proc");
    } catch {
      return members;
    }
    for (const dirent of dirents) {
      if (!/^\d+$/.test(dirent)) continue;
      const fields = procStat(dirent);
      if (!fields || fields[0] === "Z") continue;
      if (Number(fields[2]) === pgid) members.push(Number(dirent));
    }
    return members;
  }
  // ps runs as a child of the caller, so it is in the caller's group. Its
  // own pid is left out.
  const listed = spawnSync(systemTool("ps"), ["-A", "-o", "pid=,pgid=,stat="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, LC_ALL: "C" },
  });
  if (listed.status !== 0) return members;
  for (const line of listed.stdout.split("\n")) {
    const [pid, group, stat] = line.trim().split(/\s+/);
    if (Number(pid) === listed.pid) continue;
    if (Number(group) === pgid && !String(stat).startsWith("Z")) {
      members.push(Number(pid));
    }
  }
  return members;
}

// Selected identity fields for diagnostics: the pid, when that process
// started, its executable, and the directory it serves. None of these is a
// command line or an environment, so diagnostics may print them.
export function processIdentity(pid) {
  if (!validPid(pid)) return null;
  if (onLinux) {
    const fields = procStat(pid);
    if (!fields) return null;
    // Field 22 is starttime in clock ticks since boot.
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
  if (onLinux) {
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

export function foreignNextListeners(port, exclude = []) {
  const found = [];
  for (const pid of listenerPids(port)) {
    if (exclude.includes(pid)) continue;
    if (!isNextDevCommand(commandLine(pid))) continue;
    found.push({ pid, cwd: processIdentity(pid)?.cwd ?? "" });
  }
  return found;
}

export function formatForeignNext(port, exclude = []) {
  const holders = foreignNextListeners(port, exclude);
  if (!holders.length) return "";
  const detail = holders
    .map((holder) => {
      const cwd = holder.cwd ? `, cwd ${holder.cwd}` : "";
      return `pid ${holder.pid}${cwd}`;
    })
    .join("; ");
  return `another next dev holds port ${port} (${detail}). This skill did not start it and will not stop it.`;
}

// ---- State lock -------------------------------------------------------------

// launch and cleanup change run.json, the socket, and the next-env snapshot.
// Each holds an exclusive lock on the state directory while it does: a file
// created with O_EXCL that holds a random nonce, removed only by the holder
// that nonce names. A lock left by a command that died is never taken over;
// the next launch or cleanup refuses and says how to remove it.

export class StateLockedError extends UnsafeStateError {}

export function lockPath(dir = stateDir) {
  return path.join(dir, "verify.lock");
}

function lockHolder(file) {
  try {
    const held = JSON.parse(readPrivateFile(file) ?? "null");
    const command = ["launch", "cleanup"].includes(held?.command)
      ? held.command
      : "a verify command";
    const pid = validPid(held?.pid) ? `pid ${held.pid}, ` : "";
    const since =
      typeof held?.since === "string" && /^[0-9T:.Z-]{1,30}$/.test(held.since)
        ? held.since
        : "unknown";
    return `${command} (${pid}since ${since})`;
  } catch {
    return "a verify command";
  }
}

// Take the lock for `command`, or throw StateLockedError when anyone holds it.
export function acquireStateLock(command, dir = stateDir) {
  ensureDirs([dir]);
  const lock = {
    file: lockPath(dir),
    nonce: randomBytes(16).toString("hex"),
    command,
    pid: process.pid,
    since: new Date().toISOString(),
  };
  let fd;
  try {
    fd = openSync(
      lock.file,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    throw new StateLockedError(
      `verify: ${lock.file} is held by ${lockHolder(lock.file)}. Another launch or cleanup is changing this state directory. If none is running, remove that file and try again; it is never taken over.`,
    );
  }
  try {
    writeFileSync(fd, JSON.stringify(lock));
  } finally {
    closeSync(fd);
  }
  return lock;
}

export function holdsStateLock(lock) {
  if (!lock?.file || !lock.nonce) return false;
  try {
    return (
      JSON.parse(readPrivateFile(lock.file) ?? "null")?.nonce === lock.nonce
    );
  } catch {
    return false;
  }
}

// Remove the lock only while it is still this holder's.
export function releaseStateLock(lock) {
  if (!holdsStateLock(lock)) return;
  try {
    unlinkSync(lock.file);
  } catch {
    // Already gone.
  }
}

// ---- Supervisor -------------------------------------------------------------

// launch starts one detached supervisor per run. It is a session and process
// group leader (setsid), and the app it spawns stays in that group, so the
// group holds exactly what this run started. Only processes in that session
// can join the group, and its id cannot be reused while the supervisor lives.
// Stopping asks the supervisor; it signals its own group and nothing else.
// Requests and replies are authenticated with the run token from run.json.

export function socketPath(dir = stateDir) {
  return path.join(dir, "supervisor.sock");
}

export function runToken() {
  return randomBytes(32).toString("hex");
}

export function hmac(token, message) {
  return createHmac("sha256", String(token)).update(message).digest("hex");
}

export function sameDigest(left, right) {
  const a = Buffer.from(String(left), "utf8");
  const b = Buffer.from(String(right), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function clientAuth(token, op, nonce) {
  return hmac(token, `client\n${op}\n${nonce}`);
}

export function serverProof(token, nonce, body) {
  return hmac(token, `server\n${nonce}\n${JSON.stringify(body)}`);
}

function validToken(token) {
  return typeof token === "string" && /^[0-9a-f]{64}$/.test(token);
}

// One request to the supervisor in `dir`. The socket path comes from the
// validated directory, never from run.json. Resolves to
//   { gone: true }                   nothing is listening on the socket
//   { proven: false, problem }       the peer did not prove the run token
//   { proven: true, body }           the run's supervisor answered
export function supervisorRequest(
  state,
  op,
  { dir = stateDir, timeoutMs = 5_000 } = {},
) {
  return new Promise((resolve) => {
    if (!validToken(state?.token)) {
      resolve({ proven: false, problem: "run.json has no run token" });
      return;
    }
    const file = socketPath(dir);
    let stat;
    try {
      stat = lstatSync(file);
    } catch {
      resolve({ gone: true });
      return;
    }
    if (!stat.isSocket() || (uid !== null && stat.uid !== uid)) {
      resolve({
        proven: false,
        problem: `${file} is not a socket owned by this user`,
      });
      return;
    }
    const nonce = randomUUID();
    const socket = net.createConnection(file);
    let buffer = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ proven: false, problem: "the supervisor did not answer" }),
      timeoutMs,
    );
    socket.setEncoding("utf8");
    socket.once("error", (error) => {
      if (error?.code === "ECONNREFUSED" || error?.code === "ENOENT") {
        finish({ gone: true });
      } else {
        finish({ proven: false, problem: "the supervisor socket failed" });
      }
    });
    socket.once("connect", () => {
      socket.write(
        `${JSON.stringify({ op, nonce, auth: clientAuth(state.token, op, nonce) })}\n`,
      );
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 1_000_000) {
        finish({ proven: false, problem: "the supervisor reply is too long" });
        return;
      }
      const end = buffer.indexOf("\n");
      if (end === -1) return;
      let reply;
      try {
        reply = JSON.parse(buffer.slice(0, end));
      } catch {
        finish({ proven: false, problem: "the supervisor reply is not JSON" });
        return;
      }
      const body = reply?.body;
      if (
        !body ||
        typeof body !== "object" ||
        typeof reply.proof !== "string" ||
        !sameDigest(reply.proof, serverProof(state.token, nonce, body))
      ) {
        finish({
          proven: false,
          problem: "the socket did not prove it is this run's supervisor",
        });
        return;
      }
      if (body.runId !== state.runId) {
        finish({
          proven: false,
          problem: "the supervisor answered for a different run",
        });
        return;
      }
      finish({ proven: true, body });
    });
    socket.once("end", () =>
      finish({ proven: false, problem: "the supervisor closed the socket" }),
    );
  });
}

// Whether the run recorded in `dir` serves 127.0.0.1:<port> right now: its
// supervisor proves the run token, the port is the one this run was given, a
// process in the supervisor's group holds 127.0.0.1:<port>, and no process
// outside the group listens on that port. A cwd match is never enough.
export async function runOwnership(port, { dir = stateDir } = {}) {
  const { state, problem } = loadState(dir);
  if (problem) return { owned: false, reason: problem };
  if (!state) return { owned: false, reason: "no run.json" };
  if (legacyState(state)) {
    return {
      owned: false,
      reason: "run.json was written by the tmux version of this skill",
    };
  }
  if (!sameCheckout(state)) {
    return {
      owned: false,
      reason: `run.json belongs to ${state.repoRoot || "another checkout"}`,
    };
  }
  if (port !== state.port) {
    return {
      owned: false,
      reason: `this run serves ${baseUrlFor(state.port)}, not ${baseUrlFor(port)}`,
    };
  }
  const reply = await supervisorRequest(state, "status", { dir });
  if (reply.gone) {
    return { owned: false, reason: "this run's supervisor is not running" };
  }
  if (!reply.proven) return { owned: false, reason: reply.problem };
  const body = reply.body;
  if (body.stopping) return { owned: false, reason: "the run is stopping" };
  if (body.port !== port) {
    return {
      owned: false,
      reason: `the supervisor serves port ${body.port}, not ${port}`,
    };
  }
  const own = Array.isArray(body.listeners?.own) ? body.listeners.own : [];
  const foreign = Array.isArray(body.listeners?.foreign)
    ? body.listeners.foreign
    : [];
  if (foreign.length) {
    return {
      owned: false,
      reason: `a process outside this run also listens on port ${port}`,
      body,
    };
  }
  if (!own.some((listener) => listener.address === "127.0.0.1")) {
    return {
      owned: false,
      reason: `no process this run started holds 127.0.0.1:${port}`,
      body,
    };
  }
  return { owned: true, reason: "", body };
}

// Start a supervisor for `command` and record the run. The token reaches the
// supervisor over a pipe, never argv or the environment. The caller must hold
// the state lock for `dir`, so two launches never both write run.json.
export async function startSupervisor({
  command,
  args = [],
  env = process.env,
  port,
  root = repoRoot,
  dir = stateDir,
  logName = "next.log",
  lingerMs = 120_000,
  record = {},
  lock,
  onSpawn = () => {},
}) {
  ensureDirs([dir]);
  if (lock?.file !== lockPath(dir) || !holdsStateLock(lock)) {
    throw new UnsafeStateError(
      `verify: starting a run needs the lock on ${dir}. Refusing to write run.json.`,
    );
  }
  const socket = socketPath(dir);
  if (Buffer.byteLength(socket) > 100) {
    throw new UnsafeStateError(
      `verify: ${socket} is too long for a Unix socket. Set VERIFY_STATE_DIR to a shorter path.`,
    );
  }
  if (existsSync(socket)) {
    const stat = lstatSync(socket);
    if (!stat.isSocket()) {
      throw new UnsafeStateError(`verify: ${socket} is not a socket`);
    }
    if (await socketAnswers(socket)) {
      throw new UnsafeStateError(
        `verify: a supervisor already listens on ${socket}`,
      );
    }
    unlinkSync(socket);
  }
  const token = runToken();
  const runId = randomBytes(6).toString("hex");
  const appLog = path.join(dir, logName);
  const supervisorLog = path.join(dir, "supervisor.log");
  const state = {
    version: stateVersion,
    runId,
    token,
    repoRoot: canonicalPath(root),
    baseUrl: baseUrlFor(port),
    port,
    supervisorPid: null,
    appLog,
    supervisorLog,
    evidenceDir,
    startedAt: new Date().toISOString(),
    ...record,
  };
  // Recorded before the supervisor exists, so an interrupted launch or a
  // failed boot is still cleaned up through the socket.
  writeState(state, dir);
  const logFd = openSync(
    supervisorLog,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
    0o600,
  );
  let child;
  try {
    child = spawn(process.execPath, [supervisorScript], {
      cwd: root,
      detached: true,
      stdio: ["pipe", logFd, logFd],
      env: process.env,
    });
  } finally {
    closeSync(logFd);
  }
  onSpawn(child);
  child.stdin.end(
    JSON.stringify({
      token,
      runId,
      root,
      port,
      command,
      args,
      env,
      appLog,
      socket,
      lingerMs,
    }),
  );
  child.unref();
  // The pid is for diagnostics only; stopping always goes through the socket.
  state.supervisorPid = child.pid;
  writeState(state, dir);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const reply = await supervisorRequest(state, "status", { dir });
    if (reply.proven) return { state, status: reply.body, child };
    if (child.exitCode !== null || child.signalCode !== null) break;
    await delay(100);
  }
  return { state, status: null, child };
}

function socketAnswers(file) {
  return new Promise((resolve) => {
    const socket = net.createConnection(file);
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    setTimeout(() => finish(false), 1_000).unref();
  });
}

// Ask this run's supervisor to stop its process group and wait for it to go.
export async function stopRun(state, { dir = stateDir } = {}) {
  const reply = await supervisorRequest(state, "stop", {
    dir,
    timeoutMs: 30_000,
  });
  if (reply.gone) {
    return {
      action: "gone",
      message: `the supervisor for run ${state.runId} was already gone`,
    };
  }
  if (!reply.proven) {
    return {
      action: "refused",
      message: `refused to stop run ${state.runId}: ${reply.problem}`,
    };
  }
  const leftover = Number(reply.body.leftover) || 0;
  return {
    action: "stopped",
    message: `stopped run ${state.runId}: supervisor pid ${reply.body.supervisorPid} signalled its own process group${leftover ? `; ${leftover} member${leftover === 1 ? "" : "s"} ignored SIGTERM and got SIGKILL` : ""}`,
  };
}

// ---- next-env.d.ts snapshot -------------------------------------------------

function nextEnvRecordPath() {
  return path.join(stateDir, "next-env.json");
}

function readNextEnvStore() {
  let text = null;
  try {
    text = readPrivateFile(nextEnvRecordPath());
  } catch {
    return {};
  }
  if (text === null) return {};
  try {
    const parsed = JSON.parse(text);
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
  writePrivateFile(nextEnvRecordPath(), `${JSON.stringify({ checkouts })}\n`);
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
  writeFileSync(dest, String(record.snapshot ?? ""), { mode: 0o600 });
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

// ---- Doctor -----------------------------------------------------------------

function describeOwnership(ownership) {
  if (!ownership.owned) return `doctor: not owned (${ownership.reason})`;
  const own = ownership.body.listeners.own
    .map((listener) => `pid ${listener.pid}`)
    .join(", ");
  return `doctor: owned by run ${ownership.body.runId} (supervisor pid ${ownership.body.supervisorPid}; listener ${own} in its process group)`;
}

export async function checkHealth(port = defaultPort, { dir } = {}) {
  const lines = [];
  const baseUrl = baseUrlFor(port);
  // Ownership is checked before and after the page probes, so a listener
  // that changes in between is not counted as this run's.
  const before = await runOwnership(port, { dir });
  // The run's own listeners are never "another next dev", even when a
  // stranger on the same port keeps the run from being owned.
  const ownPids = Array.isArray(before.body?.listeners?.own)
    ? before.body.listeners.own.map((listener) => listener.pid)
    : [];
  const nextHint = before.owned ? "" : formatForeignNext(port, ownPids);
  const timeoutMs = nextHint ? 1_500 : 8_000;
  const [home, about, privacy] = await Promise.all([
    fetchText(new URL("/", baseUrl).href, timeoutMs),
    fetchText(new URL("/about", baseUrl).href, timeoutMs),
    fetchText(new URL("/privacy", baseUrl).href, timeoutMs),
  ]);
  const after = before.owned ? await runOwnership(port, { dir }) : before;
  const ownership =
    before.owned &&
    after.owned &&
    after.body.supervisorPid === before.body.supervisorPid
      ? after
      : after.owned
        ? { owned: false, reason: "the run changed during the probe" }
        : after;
  const owned = ownership.owned;
  const homeOk = home.status === 200 && home.text.includes(homeMarker);
  const aboutOk = about.status === 200 && about.text.includes(aboutMarker);
  const privacyOk = privacy.status === 200 && privacyPageRendered(privacy.text);
  if (nextHint) lines.push(`doctor: ${nextHint}`);

  if (home.status === 0 && about.status === 0 && privacy.status === 0) {
    lines.push(`doctor: home unreachable (${home.error || "no response"})`);
    lines.push(describeOwnership(ownership));
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
  lines.push(describeOwnership(ownership));
  lines.push(
    owned
      ? "doctor: fixture-mode recorded by verify:launch"
      : "doctor: fixture-mode unknown (verify:launch does not own this server)",
  );

  const owners = portDetails(port);
  lines.push(
    owners
      ? `doctor: port ${port}\n${owners}`
      : `doctor: port ${port} owner-unknown`,
  );

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
