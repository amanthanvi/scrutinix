#!/usr/bin/env node
import { baseUrlFor, checkHealth, parseCliArgs } from "./runtime.mjs";

const help = `verify-scrutinix doctor

Read-only check that the local app is worth driving. Sends GET / , GET /about,
and GET /privacy to http://127.0.0.1:<port>. It does not start a scan.

Usage:
  node .agents/skills/verify-scrutinix/scripts/doctor.mjs [--json] [--port <n>]
  npm run verify:doctor
  npm --silent run verify:doctor -- --port 3417

--port is an integer from 1024 to 65535. It defaults to the port verify:launch
recorded for this checkout, else 3000. Any other argument, including
--base-url, exits 2 without repeating it.

READY (exit 0) means all of the following:
  - GET / is 200 and the HTML contains "URL to analyze"
  - GET /about is 200 and the HTML contains "How a scan becomes a verdict."
  - GET /privacy is 200 and the HTML has <main id="main-content">, an <h1>, and
    the header link href="/privacy" with aria-current="page" (structure, not copy)
  - run.json, in a private state directory, is this checkout's run, and the
    run's supervisor proves the run token over its socket
  - the port is the one that run was given, a process in the supervisor's
    process group holds 127.0.0.1:<port>, and no process outside that group
    listens on the port (checked before and after the requests)

Anything else prints NOT_READY and exits 2.

Codes:
  unreachable         nothing answered on the port
  home-unhealthy      home is up without the scan box, or the status is not 200
  about-unhealthy     home is healthy and /about is not
  privacy-unhealthy   home and about are healthy and /privacy is not
  foreign-server      the pages look healthy and verify:launch does not own the server
  foreign-next        another next dev holds the port and this skill did not start it

Listeners are printed as pid, start time, executable, and cwd, never as a
command line. A cwd that matches this checkout is never ownership. A healthy
foreign server is not worth driving. When the holder is next dev, doctor
names the pid and cwd. Stop that pid yourself. See SKILL.md, "Another next
dev". Live provider mode is not observable from these GET requests. The
malicious.scrutinix.test verdict in verify:drive is the check that fixture
mode is active.
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(help);
  process.exit(0);
}

const args = parseCliArgs(undefined, { flags: ["--json"] });
if (!args.ok) {
  process.stderr.write(`doctor: ${args.message}\n`);
  process.exit(2);
}
const report = await checkHealth(args.port);

if (args.flags.has("--json")) {
  process.stdout.write(
    `${JSON.stringify({ baseUrl: baseUrlFor(args.port), ...report }, null, 2)}\n`,
  );
} else {
  process.stdout.write(`${report.lines.join("\n")}\n`);
}

process.exit(report.ok ? 0 : 2);
