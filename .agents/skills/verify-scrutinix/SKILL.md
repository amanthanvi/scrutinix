---
name: verify-scrutinix
description: "Drive the Scrutinix Next.js URL scanner on a local dev server with Playwright. Use to launch fixture mode, run the read-only doctor check, exercise scans, history, and signed shares like a user, and capture screenshots and traces."
disable-model-invocation: true
---

# Verify Scrutinix

Scrutinix is a Next.js web app. A person pastes a URL, reads a verdict band, the link's real owner, and an eight-cell signal strip, and can run a batch, export, share a signed link, or keep history in IndexedDB on this device. There is no account system. Theme is stored in `localStorage` under `theme`.

The feature map is [`references/features/README.md`](references/features/README.md). Open the one file that matches the change. Walk the README top to bottom for a broad sweep, and finish with `journeys.md`.

A maintain pass (`maintain-verification-skill`) edits only this directory: `SKILL.md`, `references/features/`, `scripts/`, and `playwright.config.mjs`. Product code stays untouched. Outcomes are `clean`, `changed` (one PR), or `blocked`.

## Isolate

This skill owns one app per checkout on `http://127.0.0.1:<port>` (default port 3000). Playwright gives each test a fresh browser context, so IndexedDB, theme, and clipboard stay inside that context. The dev server's in-memory result cache is shared by every context; its rate limit is per client address, and each drive test presents its own.

Ownership is identity, never a name or a pattern:

- `run.json` stores the checkout path in `repoRoot`, the base URL, the tmux session (its name, server-assigned id such as `$3`, creation time, and pane process), and each listener process (pid, start time, executable, and cwd).
- The tmux session name is per checkout: `scrutinix-verify-next-<hash of the checkout path>`. A name is still not ownership: tmux also prefix-matches names, and anyone can create a session with the same name after ours ends.
- Before launch reuses or restarts, and before cleanup stops anything, the recorded identity is read again from the OS and tmux. A process or session is stopped only when every field still matches and its cwd is this checkout. Otherwise it is left running and the command says why.

A different checkout does not reuse that server and does not stop it. A server this skill did not start is left running. Two checkouts that want to run at once use different ports (`--base-url`) and, when they share `/tmp`, different `VERIFY_STATE_DIR` values.

Launch accepts only `http://127.0.0.1:<port>` with a port from 1024 to 65535. `--base-url URL` and `--base-url=URL` are both read. An empty value or a value that is not a URL exits 2 with a message. It does not fall back to the default and it does not throw. Launch refuses to start a second Next server when the port is already taken by someone else.

## Launch

From the repo root, with Node 24 on `PATH` (`.nvmrc` is `24.20.0`) and tmux installed:

```bash
npm install
npx playwright install --with-deps chromium
npm run verify:launch
npm run verify:launch -- --base-url http://127.0.0.1:3417   # another port
```

`npm run verify:launch` is `node .agents/skills/verify-scrutinix/scripts/launch.mjs`. It does the following:

1. If doctor is `READY` and this checkout's recorded session still matches its identity, print `REUSED` and exit 0.
2. If `run.json` names another checkout whose session or listener is still live, or the port is open and this checkout does not own it, exit 2 and leave that process alone. When the listener is another `next dev`, launch names its pid and cwd and prints how to check and stop that exact pid.
3. If a tmux session with this checkout's name exists but is not the one recorded, exit 2 and leave it alone.
4. Run `npm ci` when `node_modules` is missing.
5. Install Playwright Chromium. Set `VERIFY_SKIP_BROWSER_INSTALL=1` to skip. If Chromium's system libraries are missing, run `npx playwright install --with-deps chromium` and launch again.
6. When this checkout owns an unhealthy session, stop that session and its recorded listeners, each after its identity is checked again, and start fresh.
7. Start the tmux session with `SCRUTINIX_TEST_FIXTURES=1`, the published e2e share key (`SHARE_SIGNING_SECRET`, exactly as `scripts/run-e2e.mjs` passes it; `SHARE_SIGNING_SECRET_PREVIOUS` empty), empty Upstash and Vercel KV variables, and `npm run dev -- --hostname 127.0.0.1 --port <port>`. The session identity is written to `run.json` as soon as tmux creates it, before ready is checked, so a failed boot is still cleaned up. Ready means doctor reports `READY`. After ready, the identity of every listener serving this checkout is recorded.
8. Snapshot `next-env.d.ts` before the dev server starts, then record the content `next dev` wrote after the file settles (`next dev` rewrites the route-type imports for its `.next/dev` dist directory). A later launch keeps that snapshot when the current file still matches the snapshot or the recorded write, including a restart of an owned server. If the file matches neither, launch drops the snapshot, warns, and saves the current file. Cleanup puts `next-env.d.ts` back only later, and only from that snapshot.

`next.config.ts` sets `agentRules: false`, so `next dev` does not rewrite `AGENTS.md` or `CLAUDE.md`. This skill does not touch either file.

The share key is public and test-only. `lib/config/env.ts` accepts it only while `SCRUTINIX_TEST_FIXTURES=1`, refuses it otherwise, and ignores every other key in fixture mode. So Share in this loop produces signed links that open as verified fixture results, and a real key is never used or needed. Do not export `SHARE_SIGNING_SECRET` yourself.

Fixture mode swaps the analyze orchestrator onto `lib/server/test-fixtures.ts`. Hostnames:

- `malicious.scrutinix.test` renders a VirusTotal conviction (`malicious`)
- `unreachable.scrutinix.test` renders `unknown`
- `feed-hit.scrutinix.test` renders a threat-feed conviction (`malicious`)
- any other public hostname, including `example.com`, renders `safe`

Those fixture hostnames do not exist in public DNS. A `malicious` verdict for `malicious.scrutinix.test` is the observation that fixture mode is on. Live VirusTotal, Google Safe Browsing, URLhaus, ThreatFox, Spamhaus, WHOIS, and real DNS are not contacted. A proof of those live providers is `INCONCLUSIVE` in this loop: it needs API keys and network, and this skill does not turn fixture mode off.

`npm run dev` is the README command. The helper adds the fixture flag and share key, binds `127.0.0.1`, and records identities. Use the helper.

Logs and state (`VERIFY_STATE_DIR` overrides `/tmp/scrutinix-verify`):

- The state directory is created with mode `0700`. Launch refuses an existing state directory that is a symlink, is owned by another user, or is group or world accessible, and it does not write the session script in that case.
- `run.json` records `repoRoot`, `baseUrl`, the session identity, and listener identities
- `scrutinix-verify-next-<hash>.log` is the dev server log. When launch fails it prints the last 4000 bytes with secrets redacted (`KEY=VALUE` pairs, secret-named keys, URL credentials, bearer tokens, and token-shaped strings). Read the raw file only when you need it, and do not paste it into a PR.
- `evidence/` is created at launch and kept by cleanup

## Doctor

Run this first whenever a drive looks wrong. It only sends GET requests.

```bash
npm run verify:doctor
```

`READY` (exit 0) means all of the following:

- `GET /` is 200 and the HTML contains `URL to analyze`
- `GET /about` is 200 and the HTML contains `How a scan becomes a verdict.`
- `GET /privacy` is 200 and the HTML has `<main id="main-content">`, an `<h1>`, and the header link `href="/privacy"` with `aria-current="page"`. This is structure, not copy, so privacy disclosure rewrites do not break doctor.
- `run.json` `repoRoot` is this checkout, and its recorded tmux session still matches by id, creation time, and pane process

Anything else prints `NOT_READY` and exits 2. Codes:

| Code                | Meaning                                                           |
| ------------------- | ----------------------------------------------------------------- |
| `unreachable`       | Nothing answered on the base URL                                  |
| `home-unhealthy`    | Home is up without the scan box, or the status is not 200         |
| `about-unhealthy`   | Home is healthy and `/about` is not                               |
| `privacy-unhealthy` | Home and about are healthy and `/privacy` is not                  |
| `foreign-server`    | The pages look healthy and this skill does not own the server     |
| `foreign-next`      | Another `next dev` holds the port and this skill did not start it |

```bash
node .agents/skills/verify-scrutinix/scripts/doctor.mjs --help
node .agents/skills/verify-scrutinix/scripts/doctor.mjs --json
node .agents/skills/verify-scrutinix/scripts/doctor.mjs --base-url http://127.0.0.1:3000
```

Doctor prints each listener on the port as `pid, started, executable, cwd`. It finds listeners with `ss -ltnp` on Linux, `/proc/net/tcp` when `ss` is missing, and `lsof` elsewhere (macOS). It never prints a command line: command lines can carry tokens. A screenshot taken while doctor is `NOT_READY` is not evidence.

Doctor cannot see `SCRUTINIX_TEST_FIXTURES` in the HTTP response. Ownership plus the fixture verdicts in `verify:drive` are the check. A healthy server this skill did not start is `foreign-server` or `foreign-next` and is not worth driving.

## Another next dev

`npm run dev` from a boot script or another terminal can already be listening on the port. Doctor then prints `another next dev holds port <port>` with the pid and cwd, and the code `foreign-next`. Launch exits 2 with the same pid and cwd. Neither command stops that process.

Find and check the listener yourself, reading selected fields only:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN -t      # pid (ss -ltnp 'sport = :3000' on Linux)
ps -o pid=,lstart=,comm= -p <pid>         # start time and executable
lsof -a -p <pid> -d cwd -Fn               # working directory (readlink /proc/<pid>/cwd on Linux)
```

Do not print `ps -o command`, `/proc/<pid>/cmdline`, or `/proc/<pid>/environ`: they can hold secrets. Stop only that exact pid, and only after its start time, executable, and cwd are the dev server you mean:

```bash
kill <pid>
```

Do not use `pkill`, `killall`, or kill by process name or pattern. `verify:cleanup` will not stop a next dev this skill did not start. When the port is free, run `npm run verify:launch` again, or launch on another port.

## Drive

Prefer the Playwright runner in this skill. It uses the same accessible names as `tests/e2e/`, and reuses `isolateRateLimit` from `tests/e2e/helpers.ts`.

Fast path (home, scan `example.com`, read the safe verdict, read IndexedDB):

```bash
npm run verify:smoke
```

Feature sweep (every file under `references/features/`):

```bash
npm run verify:drive
```

Both commands run doctor first, against the base URL recorded for this checkout (or `E2E_BASE_URL`). If doctor exits 2, the browser does not open.

One feature, after doctor is `READY`:

```bash
npm run verify:drive -- -g "batch scan"
```

`npm run verify:smoke -- -g "smoke home"` also forwards extra Playwright arguments. The config file is `playwright.config.mjs` next to this skill.

Stable handles:

- Roles and names: textbox `URL to analyze`, button `Analyze URL`, tab `Single`, tab `Batch`, textbox `URLs to analyze, one per line`, button `Start batch`, switch `Summary Full signal list`, region `Scan console`, region `Scan history`, region `Batch scan results`, region `Scan result: <verdict>`, meter `Threat score`, navigation `Primary`, navigation `Footer`, button `Switch to light theme` or `Switch to dark theme`, link `Skip to content`.
- Signal rows: label `VirusTotal signal:`, `ML Ensemble signal:`, `Google Safe Browsing signal:`, `Threat Feeds signal:`, `TLS Certificate signal:`, `Domain Registration signal:`, `DNS Profile signal:`, `Redirect Chain signal:`. On Summary, a clean scan shows `All 8 checks found nothing.` instead of rows.
- History: heading `History (<n> scans)`, textbox `Filter scan history` (visible after more than 3 saved scans), button `Clear all history`, button `Confirm clear all history`, button `Undo clear history`, button `Export history CSV`, button `Export history JSON`. One row per link: a re-scan replaces the earlier entry.
- Result actions: button `Download result (JSON)`, button `Share`, button `Re-scan`, disclosure `How we reached this verdict`.
- Shared links: a signed link opens region `Scan result: <verdict>` with `Verified Scrutinix result · checked …` and button `Run a fresh scan`. An unsigned or edited one opens label `Shared link, not verified`, heading `Check this shared link yourself`, button `Scan this link`.
- Batch: button `Export batch CSV`, button `Export batch JSON`, buttons `Open result for <host>`.
- Hooks: `#scan-console`, `#sx-url-input`, `#sx-url-error`, `#sx-batch-input`, `#main-content`.

The dev server allows 10 analyze requests per minute and 50 per day for each client address, counted in process memory for `next dev`. Every drive test presents its own address (`x-real-ip` from `isolateRateLimit`), as `tests/e2e` does, so `verify:smoke` (1 scan) and `verify:drive` (8 scans) never share a budget. A person driving one browser by hand shares one address.

The full e2e contract remains `npm run test:e2e` (production build, same fixtures and share key). Use it when the change touches a behavior the sweep does not list. `verify:smoke` is the short loop.

## Evidence

Proof artifacts go to the evidence directory (`/tmp/scrutinix-verify/evidence/`, or `VERIFY_EVIDENCE_DIR`). Cleanup never deletes that directory.

- `*.png` screenshots taken by the specs (`smoke-home.png`, `smoke-safe.png`, and the drive shots such as `verdict-malicious.png` and `single-shared-verified.png`)
- `scan.json`, `scan-history.csv`, and `batch.csv` saved from the download the UI produced
- `test-results/smoke/` and `test-results/drive/` Playwright traces (`trace.zip` per test, trace is `on`). A later smoke run does not delete drive traces, and a later drive run does not delete smoke traces.
- `playwright-report/smoke/` and `playwright-report/drive/` HTML reports

A proof exercises the user path: type in the scan box, click Analyze, press Enter, switch Summary to Full, open a signal row, export, share, clear history. Reading `GET /` is the doctor check, not the proof that a scan works.

Capture the action and the end state. Examples: the scan box filled, then region `Scan result: safe`; Clear confirmed, then IndexedDB `scrutinix-v2` has no rows; Undo, then those rows are back.

Side effects worth reading:

- Verdict region accessible name and meter `aria-valuenow`
- IndexedDB database `scrutinix-v2`, object store `scans`, field `url` (normalized, so `example.com` is stored as `https://example.com/`)
- Downloaded `scan.json`, `scan-history.csv`, and `batch.csv` contents
- Clipboard text after Share: a `shared` payload and a `sig`, and what each URL opens (verified with `sig`, neutral without)
- `localStorage['theme']` and the `class` on `html` after a reload
- Signal detail text that only the fixture provider would produce, such as `Fixture CA` on the TLS row
- Re-scan of the same URL shows `· cached` under `How we reached this verdict` within 15 minutes

The fixture table is the same production orchestrator path with the provider functions replaced. Do not stub the React tree or call the verdict builder from the test. Cancel during an in-flight scan is `INCONCLUSIVE` here: fixture signals resolve before the Cancel button is a stable target. Observe Cancel only against a slow live provider, which this loop does not run.

## Cleanup

```bash
npm run verify:cleanup
```

That runs `node .agents/skills/verify-scrutinix/scripts/cleanup.mjs`. When `run.json` `repoRoot` is this checkout, it re-reads each recorded session and listener:

- the tmux session is killed by its id only when its id, creation time, pane pid, pane start time, and pane cwd still match;
- each listener gets `SIGTERM` only when its pid, start time, executable, and cwd still match and the cwd is this checkout.

Anything that differs (a reused pid, a reused session name, a process serving another checkout, a bare pid or name-only session from an older `run.json`) is left running; cleanup prints why on stderr and exits 1. A `run.json` for another checkout is printed and left running. Nothing is stopped by name or pattern.

Cleanup leaves the evidence directory in place and prints that path. It restores `next-env.d.ts` to the snapshot taken at launch only when the file still equals the content this run wrote. If the file differs, cleanup leaves it unchanged, saves the snapshot bytes under the evidence directory, and prints that path. An unfinished snapshot, taken before the run recorded what it wrote, is dropped too, including when `run.json` is missing. After every failed launch or drive, run cleanup before starting again so a half-started session does not keep the port.

Confirm the evidence directory still exists after cleanup before citing it.

## Helpers

| Command                  | Script                                                     |
| ------------------------ | ---------------------------------------------------------- |
| `npm run verify:launch`  | `scripts/launch.mjs`                                       |
| `npm run verify:doctor`  | `scripts/doctor.mjs`                                       |
| `npm run verify:smoke`   | `scripts/smoke.mjs` (doctor, then `smoke.spec.ts`)         |
| `npm run verify:drive`   | `scripts/smoke.mjs --drive` (doctor, then `drive.spec.ts`) |
| `npm run verify:cleanup` | `scripts/cleanup.mjs`                                      |
| `npm run verify:check`   | `scripts/runtime.check.mjs` (the skill's own tests)        |

```bash
node .agents/skills/verify-scrutinix/scripts/launch.mjs --help
node .agents/skills/verify-scrutinix/scripts/doctor.mjs --help
node .agents/skills/verify-scrutinix/scripts/smoke.mjs --help
node .agents/skills/verify-scrutinix/scripts/cleanup.mjs --help
```

`npm run verify:check` needs tmux. It starts and stops only its own child processes and its own uniquely named tmux sessions, by exact pid and session id.

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

A missing check is `INCONCLUSIVE`. Do not describe it as passed. Do not paste raw dev-server logs or process command lines into the report.

## Feature map

[`references/features/README.md`](references/features/README.md) is the sweep order. Each feature file has the same four headings: Sub-features, How to get to it (user POV), Driving it with Playwright, Gotchas.
