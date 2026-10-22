#!/usr/bin/env node
import { checkHealth, parseCliBaseUrl } from "./runtime.mjs";

const help = `verify-scrutinix doctor

Read-only check that the local app is worth driving. Sends GET / , GET /about,
and GET /privacy. It does not start a scan.

Usage:
  node .agents/skills/verify-scrutinix/scripts/doctor.mjs [--json] [--base-url URL]
  npm run verify:doctor

READY (exit 0) means all of the following:
  - GET / is 200 and the HTML contains "URL to analyze"
  - GET /about is 200 and the HTML contains "How a scan becomes a verdict."
  - GET /privacy is 200 and the HTML has <main id="main-content">, an <h1>, and
    the header link href="/privacy" with aria-current="page" (structure, not copy)
  - /tmp/scrutinix-verify/run.json repoRoot is this checkout, it lists tmux session scrutinix-verify-next, and that session exists

Anything else prints NOT_READY and exits 2.

Codes:
  unreachable         nothing answered on the base URL
  home-unhealthy      home is up without the scan box, or the status is not 200
  about-unhealthy     home is healthy and /about is not
  privacy-unhealthy   home and about are healthy and /privacy is not
  foreign-server      the pages look healthy and verify:launch does not own the server
  foreign-next        another next dev holds port 3000 and this skill did not start it

A healthy foreign server is not worth driving. When the holder is next dev,
doctor names the pid and cwd. Stop that pid yourself. See SKILL.md,
"Another next dev". Live provider mode is not
observable from these GET requests. The malicious.scrutinix.test verdict in
verify:drive is the check that fixture mode is active.
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(help);
  process.exit(0);
}

const asJson = process.argv.includes("--json");
const parsedBaseUrl = parseCliBaseUrl();
if (!parsedBaseUrl.ok) {
  process.stderr.write(`doctor: ${parsedBaseUrl.message}\n`);
  process.exit(2);
}
const baseUrl = parsedBaseUrl.baseUrl;
const report = await checkHealth(baseUrl);

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(`${report.lines.join("\n")}\n`);
}

process.exit(report.ok ? 0 : 2);
