import { spawnSync } from "node:child_process";
import { closeSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  baseUrlFor,
  clearEvidenceFiles,
  ensureDirs,
  evidenceDir,
  exitSummary,
  logPath,
  openPrivateLog,
  parseCliArgs,
  repoRoot,
  skillDir,
  stateDir,
  summarizePlaywrightReport,
} from "./runtime.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

// The only Playwright arguments passed through: a title filter. A second
// --config, a spec path, a reporter, or an output option would run, or
// write, something other than this skill's own suite, and its failing
// titles would be printed as this suite's. Returns null for anything else.
export function forwardedPlaywrightArgs(rest) {
  const out = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "-g" || arg === "--grep") {
      const pattern = rest[i + 1];
      if (pattern === undefined || pattern.startsWith("-")) return null;
      out.push("--grep", pattern);
      i += 1;
    } else if (arg.startsWith("--grep=") && arg.length > "--grep=".length) {
      out.push(arg);
    } else {
      return null;
    }
  }
  return out;
}

// Playwright and its browser read many settings from the environment ahead
// of the config: report destinations (PLAYWRIGHT_HTML_*, JSON_*), the
// inspector (PWDEBUG), debug files (DEBUG_FILE), a remote browser
// (SELENIUM_REMOTE_*), and more, in several spellings. Rather than chase
// each one, the child gets an allowlist: what a headless local run needs
// (paths, locale, terminal, CI, and where browsers are installed), plus
// what this script sets below. Nothing else is inherited, secrets included.
const INHERITED_ENV = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "TZ",
  "LANG",
  "LANGUAGE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "CI",
  "PLAYWRIGHT_BROWSERS_PATH",
  "PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS",
  // Windows equivalents of the paths above.
  "SystemRoot",
  "windir",
  "ComSpec",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
]);
const INHERITED_PREFIXES = ["LC_", "XDG_"];
export function playwrightChildEnv(parent) {
  return Object.fromEntries(
    Object.entries(parent).filter(
      ([key]) =>
        INHERITED_ENV.has(key) ||
        INHERITED_PREFIXES.some((prefix) => key.startsWith(prefix)),
    ),
  );
}

// Run doctor, then the smoke or drive spec through the Playwright CLI at
// `cli`, and return the exit code. smoke.mjs always passes the real
// @playwright/test CLI; only runtime.check.mjs passes a stand-in, as this
// argument. Nothing in the environment can swap the runner.
export function runSuite(argv, cli) {
  const args = parseCliArgs(argv, { flags: ["--drive"], rest: true });
  if (!args.ok) {
    process.stderr.write(`smoke: ${args.message}\n`);
    return 2;
  }
  const forwarded = forwardedPlaywrightArgs(args.rest);
  if (!forwarded) {
    process.stderr.write(
      "smoke: only -g/--grep <title pattern> is passed to Playwright; the config, specs, and reporters are fixed\n",
    );
    return 2;
  }
  const suite = args.flags.has("--drive") ? "drive" : "smoke";
  const spec = path.join(scriptDir, `${suite}.spec.ts`);
  const config = path.join(skillDir, "playwright.config.mjs");

  // doctor prints only fixed messages and selected fields (pid, start time,
  // executable, cwd), the same lines it prints on its own.
  const doctor = spawnSync(
    process.execPath,
    [path.join(scriptDir, "doctor.mjs"), "--port", String(args.port)],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (doctor.stdout) process.stdout.write(doctor.stdout);
  if (doctor.stderr) process.stderr.write(doctor.stderr);
  if (doctor.status !== 0) {
    process.stderr.write("smoke: doctor is not READY, browser not started\n");
    return doctor.status ?? 2;
  }

  // Doctor failed above, so a NOT_READY run keeps the previous evidence.
  // This run's directory should not still hold an earlier run's shots.
  // The state directory, and an unmarked VERIFY_EVIDENCE_DIR, are refused
  // before Playwright. The default evidence directory is adopted. run.json
  // is left where it is.
  let removed;
  try {
    removed = clearEvidenceFiles();
  } catch (error) {
    process.stderr.write(
      `smoke: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
  process.stdout.write(
    `${suite}: cleared ${removed} previous file${removed === 1 ? "" : "s"} from the evidence directory\n`,
  );

  const log = logPath(`${suite}.log`);
  const reportFile = logPath(`${suite}-report.json`);
  rmSync(reportFile, { force: true });
  // The HTML report and traces hold raw test output: private, like the log.
  const rawDir = path.join(stateDir, "playwright", suite);
  ensureDirs([path.dirname(rawDir), rawDir]);
  const env = {
    ...playwrightChildEnv(process.env),
    PLAYWRIGHT_HTML_OPEN: "never",
    E2E_BASE_URL: baseUrlFor(args.port),
    VERIFY_EVIDENCE_DIR: evidenceDir,
    VERIFY_RAW_DIR: rawDir,
    VERIFY_SUITE: suite,
    VERIFY_REPORT_FILE: reportFile,
  };
  // Everything Playwright writes (report, traces, screenshots) is private to
  // this user.
  process.umask(0o077);
  const fd = openPrivateLog(log);
  let child;
  try {
    child = spawnSync(
      process.execPath,
      [cli, "test", "--config", config, spec, ...forwarded],
      { cwd: repoRoot, env, stdio: ["ignore", fd, fd] },
    );
  } finally {
    closeSync(fd);
  }

  // A run passes only when Playwright exits 0 and its JSON report shows at
  // least one test that ran. A missing report, or one with no test in it,
  // fails whatever the exit status was.
  const summary = summarizePlaywrightReport(reportFile);
  const ran = summary ? summary.passed + summary.failed + summary.flaky : 0;
  const code = child.status === 0 && ran > 0 ? 0 : child.status || 1;
  const out = code === 0 ? process.stdout : process.stderr;
  if (summary) {
    out.write(
      `${suite}: Playwright ${exitSummary(child)}: ${summary.passed} passed, ${summary.failed} failed, ${summary.flaky} flaky, ${summary.skipped} skipped\n`,
    );
    for (const title of summary.failedTitles) {
      out.write(`${suite}: failed: ${title}\n`);
    }
    if (summary.errors) {
      out.write(
        `${suite}: ${summary.errors} error${summary.errors === 1 ? "" : "s"} outside any test (see the log)\n`,
      );
    }
    if (!ran) out.write(`${suite}: no test ran, so nothing was verified\n`);
  } else {
    out.write(
      `${suite}: Playwright ${exitSummary(child)} and wrote no report, so nothing was verified\n`,
    );
  }
  out.write(`${suite}: log ${log} (raw, mode 0600; do not paste it)\n`);
  out.write(
    `${suite}: HTML report ${path.join(rawDir, "report")} and traces ${path.join(rawDir, "test-results")} (raw and private; do not upload or paste them)\n`,
  );
  out.write(`${suite}: evidence directory ${evidenceDir}\n`);
  return code;
}
