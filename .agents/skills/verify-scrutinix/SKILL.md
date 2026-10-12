---
name: verify-scrutinix
description: "Drive the Scrutinix Next.js URL scanner on a local dev server with Playwright. Use to launch fixture mode, run the read-only doctor check, exercise scans and history like a user, and capture screenshots and traces."
disable-model-invocation: true
---

# Verify Scrutinix

Scrutinix is a Next.js web app. A person pastes a URL, reads a verdict and eight signal rows, and can run a batch, export, share, or keep history in IndexedDB on this device. There is no account system. Theme is stored in `localStorage` under `theme`.

The feature map is [`references/features/README.md`](references/features/README.md). Open the one file that matches the change. Walk the README top to bottom for a broad sweep, and finish with `journeys.md`.

A maintain pass (`maintain-verification-skill`) edits only this directory: `SKILL.md`, `references/features/`, `scripts/`, and `playwright.config.mjs`. Product code stays untouched. Outcomes are `clean`, `changed` (one PR), or `blocked`.

## Isolate

This skill owns one app on `http://127.0.0.1:3000`. Playwright gives each test a fresh browser context, so IndexedDB, theme, and clipboard stay inside that context. The dev server's in-memory rate limit and result cache are shared by every context on this machine.

When doctor already reports `READY` for a server this skill started, launch reuses that server. Cleanup stops only the tmux session and listener pids recorded in `/tmp/scrutinix-verify/run.json`. A server this skill did not start is left running.

Launch refuses a base URL other than `http://127.0.0.1:3000`. It refuses to start a second Next server when port 3000 is already taken by someone else.

Two verify drives must not share one server at the same time. The minute rate limit is 10 analyze requests for the whole process.

## Launch

From the repo root, with Node 24 on `PATH` (`.nvmrc` is `24.20.0`):

```bash
npm install
npx playwright install --with-deps chromium
npm run verify:launch
```

`npm run verify:launch` is `node .agents/skills/verify-scrutinix/scripts/launch.mjs`. It does the following:

1. If doctor is `READY` and `/tmp/scrutinix-verify/run.json` lists a live `scrutinix-verify-next` tmux session, print `REUSED` and exit 0.
2. If port 3000 is open and this skill did not start it, exit 2 and leave that process alone.
3. Run `npm ci` when `node_modules` is missing.
4. Install Playwright Chromium. Set `VERIFY_SKIP_BROWSER_INSTALL=1` to skip. If Chromium's system libraries are missing, run `npx playwright install --with-deps chromium` and launch again.
5. When this skill already owns an unhealthy session, stop that session and start it again.
6. Start tmux session `scrutinix-verify-next` with `SCRUTINIX_TEST_FIXTURES=1`, empty Upstash and Vercel KV variables, and `npm run dev -- --hostname 127.0.0.1 --port 3000`. Ready means doctor reports `READY`. The hostname is required so the dev server accepts the browser on IPv4 loopback.

Fixture mode swaps the analyze orchestrator onto `lib/server/test-fixtures.ts`. Hostnames:

- `malicious.scrutinix.test` renders a VirusTotal conviction (`malicious`)
- `unreachable.scrutinix.test` renders `unknown`
- `feed-hit.scrutinix.test` renders a threat-feed conviction (`malicious`)
- any other public hostname, including `example.com`, renders `safe`

Those fixture hostnames do not exist in public DNS. A `malicious` verdict for `malicious.scrutinix.test` is the observation that fixture mode is on. Live VirusTotal, Google Safe Browsing, URLhaus, ThreatFox, Spamhaus, WHOIS, and real DNS are not contacted. A proof of those live providers is `INCONCLUSIVE` in this loop: it needs API keys and network, and this skill does not turn fixture mode off.

`npm run dev` is the README command. The helper adds the fixture flag, binds `127.0.0.1`, and records the tmux session. Use the helper.

Logs and state:

- `/tmp/scrutinix-verify/run.json` lists the session and listener pids this launch started
- `/tmp/scrutinix-verify/scrutinix-verify-next.log`
- `/tmp/scrutinix-verify/evidence/` is created at launch and kept by cleanup

## Doctor

Run this first whenever a drive looks wrong. It only sends GET requests.

```bash
npm run verify:doctor
```

`READY` (exit 0) means all of the following:

- `GET /` is 200 and the HTML contains `URL to analyze`
- `GET /about` is 200 and the HTML contains `How a scan becomes a verdict.`
- `GET /privacy` is 200 and the HTML contains `History stays in the browser.`
- `run.json` lists tmux session `scrutinix-verify-next` and that session exists

Anything else prints `NOT_READY` and exits 2. Codes:

| Code                | Meaning                                                       |
| ------------------- | ------------------------------------------------------------- |
| `unreachable`       | Nothing answered on the base URL                              |
| `home-unhealthy`    | Home is up without the scan box, or the status is not 200     |
| `about-unhealthy`   | Home is healthy and `/about` is not                           |
| `privacy-unhealthy` | Home and about are healthy and `/privacy` is not              |
| `foreign-server`    | The pages look healthy and this skill does not own the server |

```bash
node .agents/skills/verify-scrutinix/scripts/doctor.mjs --help
node .agents/skills/verify-scrutinix/scripts/doctor.mjs --json
node .agents/skills/verify-scrutinix/scripts/doctor.mjs --base-url http://127.0.0.1:3000
```

Doctor prints who is listening on port 3000. It uses `ss -ltnp` when `ss` exists, and otherwise reads `/proc/net/tcp`. A screenshot taken while doctor is `NOT_READY` is not evidence.

Doctor cannot see `SCRUTINIX_TEST_FIXTURES` in the HTTP response. Ownership plus the fixture verdicts in `verify:drive` are the check. A healthy server this skill did not start is `foreign-server` and is not worth driving.

## Drive

Prefer the Playwright runner in this skill. It uses the same accessible names as `tests/e2e/`.

Fast path (home, scan `example.com`, read the safe verdict, read IndexedDB):

```bash
npm run verify:smoke
```

Feature sweep (every file under `references/features/`):

```bash
npm run verify:drive
```

Both commands run doctor first. If doctor exits 2, the browser does not open.

One feature, after doctor is `READY`:

```bash
E2E_BASE_URL=http://127.0.0.1:3000 \
VERIFY_EVIDENCE_DIR=/tmp/scrutinix-verify/evidence \
npx playwright test \
  --config .agents/skills/verify-scrutinix/playwright.config.mjs \
  .agents/skills/verify-scrutinix/scripts/drive.spec.ts \
  -g "batch scan"
```

Run that from the repo root. The config file is `playwright.config.mjs` next to this skill. `npm run verify:drive` is the same spec with doctor in front. `npm run verify:smoke -- -g "smoke home"` also forwards extra Playwright arguments.

Stable handles:

- Roles and names: textbox `URL to analyze`, button `Analyze URL`, tab `Single`, tab `Batch`, textbox `URLs to analyze, one per line`, button `Start batch`, switch `Show full signal list`, region `Scan console`, region `Scan history`, region `Batch scan results`, region `Scan result: <verdict>`, meter `Threat score`, navigation `Primary`, button `Switch to light theme` or `Switch to dark theme`, link `Skip to content`.
- Signal rows: label `VirusTotal signal:`, `ML Ensemble signal:`, `Google Safe Browsing signal:`, `Threat Feeds signal:`, `TLS Certificate signal:`, `Domain Registration signal:`, `DNS Profile signal:`, `Redirect Chain signal:`.
- History: textbox `Filter scan history` (visible after more than 3 saved scans), button `Clear all history`, button `Confirm clear all history`, button `Undo clearing scan history`, button `Export history as CSV`, button `Export history as JSON`.
- Result actions: button `Export JSON`, button `Share`, button `Re-scan`, button `Run fresh scan`.
- Hooks: `#scan-console`, `#sx-url-input`, `#sx-batch-input`, `#main-content`.

The dev server allows 10 analyze requests per minute and 50 per day, counted in process memory for `next dev`. `verify:smoke` uses 1 request. `verify:drive` uses 8 (one safe scan, one re-scan, three fixture hostnames, `example.org`, and a batch of two). Running both in the same minute uses 9. A second drive inside that minute receives `Rate limit exceeded. Please retry after the cooldown window.` Restart with `npm run verify:cleanup` and `npm run verify:launch` to clear the in-memory window, or wait 60 seconds.

The full e2e contract remains `npm run test:e2e` (production build, same fixtures). Use it when the change touches a behavior the sweep does not list. `verify:smoke` is the short loop.

## Evidence

Proof artifacts go to `/tmp/scrutinix-verify/evidence/` (override with `VERIFY_EVIDENCE_DIR`). Cleanup never deletes that directory.

- `*.png` screenshots taken by the specs (`smoke-home.png`, `smoke-safe.png`, and the drive shots such as `verdict-malicious.png`)
- `scan.json`, `scan-history.csv`, and `batch.csv` saved from the download the UI produced
- `test-results/` Playwright traces (`trace.zip` per test, trace is `on`)
- `playwright-report/` HTML report

A proof exercises the user path: type in the scan box, click Analyze, press Enter, switch Summary to Full, open a signal row, export, share, clear history. Reading `GET /` is the doctor check, not the proof that a scan works.

Capture the action and the end state. Examples: the scan box filled, then region `Scan result: safe`; Clear confirmed, then IndexedDB `scrutinix-v2` has no rows; Undo, then those rows are back.

Side effects worth reading:

- Verdict region accessible name and meter `aria-valuenow`
- IndexedDB database `scrutinix-v2`, object store `scans`, field `url` (normalized, so `example.com` is stored as `https://example.com/`)
- Downloaded `scan.json`, `scan-history.csv`, and `batch.csv` contents
- Clipboard text after Share, decoded from the `shared` query parameter
- `localStorage['theme']` and the `class` on `html` after a reload
- Signal detail text that only the fixture provider would produce, such as `Fixture CA` on the TLS row
- Re-scan of the same URL shows `cached` in the verdict details within 15 minutes

The fixture table is the same production orchestrator path with the provider functions replaced. Do not stub the React tree or call the verdict builder from the test. Cancel during an in-flight scan is `INCONCLUSIVE` here: fixture signals resolve before the Cancel button is a stable target. Observe Cancel only against a slow live provider, which this loop does not run.

## Cleanup

```bash
npm run verify:cleanup
```

That runs `node .agents/skills/verify-scrutinix/scripts/cleanup.mjs`. It `tmux kill-session`s only sessions listed in `run.json`, then sends `SIGTERM` only to recorded listener pids whose command line still contains this repo or `next`. It does not kill processes by name. It leaves `/tmp/scrutinix-verify/evidence/` in place and prints that path. After every failed launch or drive, run cleanup before starting again so a half-started session does not keep the port.

Confirm the evidence directory still exists after cleanup before citing it.

## Helpers

| Command                  | Script                                                     |
| ------------------------ | ---------------------------------------------------------- |
| `npm run verify:launch`  | `scripts/launch.mjs`                                       |
| `npm run verify:doctor`  | `scripts/doctor.mjs`                                       |
| `npm run verify:smoke`   | `scripts/smoke.mjs` (doctor, then `smoke.spec.ts`)         |
| `npm run verify:drive`   | `scripts/smoke.mjs --drive` (doctor, then `drive.spec.ts`) |
| `npm run verify:cleanup` | `scripts/cleanup.mjs`                                      |

```bash
node .agents/skills/verify-scrutinix/scripts/launch.mjs --help
node .agents/skills/verify-scrutinix/scripts/doctor.mjs --help
node .agents/skills/verify-scrutinix/scripts/smoke.mjs --help
node .agents/skills/verify-scrutinix/scripts/cleanup.mjs --help
```

`scripts/evidence.ts` writes screenshots and downloads into `VERIFY_EVIDENCE_DIR`. `scripts/support.ts` holds the shared Playwright steps (`gotoApp`, `fillSingle`, `scanSingle`, `historyState`).

## How to report

Put a Proof section on the pull request:

```markdown
### Proof

- Commands: the exact commands, including `npm run verify:doctor` and the drive you ran
- Evidence: screenshot and trace paths that still exist after cleanup
- Results: pass or fail per command, plus the observable end state (URL, verdict region, IndexedDB, download, clipboard, theme)
- INCONCLUSIVE: any step that could not run, and the concrete reason (port busy, browser missing, fixture mode required, live provider keys absent, rate limit window)
```

A missing check is `INCONCLUSIVE`. Do not describe it as passed.

## Feature map

[`references/features/README.md`](references/features/README.md) is the sweep order. Each feature file has the same four headings: Sub-features, How to get to it (user POV), Driving it with Playwright, Gotchas.
