---
name: verify-scrutinix
description: "Drive the Scrutinix Next.js URL scanner on a local dev server with Playwright. Use to launch fixture mode, run the read-only doctor check, exercise scans, history, and signed shares like a user, and capture screenshots and traces."
disable-model-invocation: true
---

# Verify Scrutinix

Scrutinix is a Next.js web app that asks "Is this link what it says it is?". A person pastes a link and sees it taken apart at once (which site it really belongs to, and whether it only spells out another one), before anything is scanned. Analyze streams eight checks into a verdict band (the verdict word, the registered domain under it, one instruction), then Evidence: a numbered eight-cell strip over five plain questions (Summary) or the eight check rows (Full). They can run a batch of up to 10, export, share a signed result, or keep history in IndexedDB on this device. A link can also arrive from outside (`/?url=`, or the Android share target `POST /share`); it is filled in and taken apart, and nothing scans until the person taps Analyze. There is no account system. Theme is stored in `localStorage` under `theme`.

The feature map is [`references/features/README.md`](references/features/README.md). Open the one file that matches the change. Walk the README top to bottom for a broad sweep, and finish with `journeys.md`.

A maintain pass (`maintain-verification-skill`) edits only this directory: `SKILL.md`, `references/features/`, `scripts/`, and `playwright.config.mjs`. Product code stays untouched. Outcomes are `clean`, `changed` (one PR), or `blocked`.

## Isolate

This skill owns one app per checkout on `http://127.0.0.1:<port>` (default port 3000). Playwright gives each test a fresh browser context, so IndexedDB, theme, and clipboard stay inside that context. The dev server's in-memory result cache is shared by every context; its rate limit is per client address, and each drive test presents its own.

Ownership is what launch started, never a name, a pattern, or a cwd:

- Launch starts a small detached supervisor (`scripts/supervisor.mjs`). It leads its own session and process group, and it spawns `next dev` in that group, so every process in the group is one this run started: `next dev` and whatever `next dev` starts without leaving the group. No process outside the session can join the group, and its id cannot be reused while the supervisor lives.
- The supervisor answers on a Unix socket, `supervisor.sock`, mode `0600`, in the private state directory. Every request carries an HMAC of a random per-run token, and every reply carries one back. The token reaches the supervisor over a pipe, never argv or the environment, and is kept in `run.json` (mode `0600`).
- Stopping asks the supervisor. It sends `SIGTERM` to its own group, waits for its child (which it has not yet reaped, so the pid cannot be reused), then `SIGKILL`s whatever ignored that, and exits. Cleanup itself never signals a pid. Nothing re-finds processes by pid, start time, cwd, name, or tmux session.
- What a stop reaches is exactly the processes still in the supervisor's group. A descendant that leaves it (one that runs `setsid`, or is spawned `detached`) is not stopped and is not looked for. After every stop the run's socket must stop answering and its port must be free; if either still answers, cleanup names the listener (`pid, started, executable, cwd`), reports the cleanup as incomplete, leaves it running, and exits 1. A descendant that left the group and holds neither the port nor the socket is not seen at all.
- Launch and cleanup hold an exclusive lock on the state directory (`verify.lock`, created with `O_EXCL`, holding a random nonce, removed only by its holder) while they read and change `run.json`, the socket, and the `next-env.d.ts` snapshot. A second launch or cleanup refuses (exit 2) instead of interleaving, and a concurrent launch that loses never writes `run.json`. A lock left by a command that was killed is never taken over: the next command names it and exits 2. Remove that file yourself once no launch or cleanup is running.
- The run serves only the `127.0.0.1` port it was given. Doctor reports it as owned only when the supervisor proves the token, a process in its group holds `127.0.0.1:<port>`, and nothing outside the group listens on that port. Doctor checks this before and after its requests. A server from this checkout that the supervisor did not start is not owned.

A different checkout does not reuse that server and does not stop it. A server this skill did not start is left running. Two checkouts that want to run at once use different ports (`--port`) and, when they share `/tmp`, different `VERIFY_STATE_DIR` values.

The server is always `http://127.0.0.1:<port>`. Launch, doctor, smoke, and drive take `--port <n>` or `--port=<n>`, an integer from 1024 to 65535, and default to the port this checkout last launched on, else 3000. No command takes a URL, so no argument can carry a user name, password, or token, and `E2E_BASE_URL` is not read. `--base-url`, a port that is not a plain integer in range, a repeated `--port`, and any argument a command does not take exit 2 with a message that never repeats the input. Cleanup takes no arguments. Launch refuses to start a second Next server when the port is already taken by someone else.

npm prints every script's arguments in its banner (and in its error footer when the script fails) before the script runs, so whatever you type after `--` is echoed by npm itself. Never pass a secret there. `npm --silent run verify:doctor -- --port 3417` suppresses npm's own lines, and the skill's output is then only its own.

## Launch

From the repo root, with Node 24 on `PATH` (`.nvmrc` is `24.20.0`):

```bash
npm install
npx playwright install --with-deps chromium
npm run verify:launch
npm run verify:launch -- --port 3417   # another port
```

`npm run verify:launch` is `node .agents/skills/verify-scrutinix/scripts/launch.mjs`. It does the following:

1. Refuse (exit 2) when the state directory or `run.json` fails the checks under "Logs and state", or when another launch or cleanup holds the state lock.
2. If this checkout's supervisor answers and doctor is `READY` on the requested URL, print `REUSED` and exit 0. If it answers and doctor is not `READY` (unhealthy, or another port), ask it to stop and start fresh.
3. If `run.json` names another checkout whose supervisor still answers, or the port is open and this run does not own it, exit 2 and leave that process alone. When the listener is another `next dev`, launch names its pid and cwd and prints how to check and stop that exact pid. A `run.json` from the tmux version of this skill is reported with its recorded pids, never acted on, and replaced.
4. Run `npm ci` when `node_modules` is missing. Its output goes to `install.log` in the state directory; launch prints only the exit status and the log path.
5. Install Playwright Chromium, with its output in `browsers.log`. Set `VERIFY_SKIP_BROWSER_INSTALL=1` to skip. If Chromium's system libraries are missing, run `npx playwright install --with-deps chromium` and launch again.
6. Start the supervisor, which runs `next dev --hostname 127.0.0.1 --port <port>` (the `npm run dev` script, run directly) with `SCRUTINIX_TEST_FIXTURES=1`, the published e2e share key (`SHARE_SIGNING_SECRET`, exactly as `scripts/run-e2e.mjs` passes it; `SHARE_SIGNING_SECRET_PREVIOUS` empty), and empty Upstash and Vercel KV variables. `run.json` is written as soon as the supervisor starts, before ready is checked, so a failed boot is still cleaned up. Ready means a process in the supervisor's group holds `127.0.0.1:<port>`, then doctor reports `READY`. If next dev exits or another process takes the port first, launch prints the reason, the exit status, and the log path, never the log, and exits 1.
7. Snapshot `next-env.d.ts` before the dev server starts, then record the content `next dev` wrote after the file settles (`next dev` rewrites the route-type imports for its `.next/dev` dist directory). A later launch keeps that snapshot when the current file still matches the snapshot or the recorded write, including a restart of an owned server. If the file matches neither, launch drops the snapshot, warns, and saves the current file. Cleanup puts `next-env.d.ts` back only later, and only from that snapshot.

`next.config.ts` sets `agentRules: false`, so `next dev` does not rewrite `AGENTS.md` or `CLAUDE.md`. This skill does not touch either file.

The share key is public and test-only. `lib/config/env.ts` accepts it only while `SCRUTINIX_TEST_FIXTURES=1`, refuses it otherwise, and ignores every other key in fixture mode. So Share in this loop produces signed links that open as verified fixture results, and a real key is never used or needed. Do not export `SHARE_SIGNING_SECRET` yourself.

Fixture mode swaps the analyze orchestrator onto `lib/server/test-fixtures.ts`. Hostnames:

- `malicious.scrutinix.test` renders a VirusTotal conviction (`malicious`)
- `feed-hit.scrutinix.test` renders a URLhaus listing (`malicious`)
- `critical.scrutinix.test` renders VirusTotal, Safe Browsing, and a feed together (`critical`)
- `unreachable.scrutinix.test` renders a dead host (`unknown`)
- `error.scrutinix.test` fails every check (`error`)
- `long-hop.scrutinix.test` redirects once to a 63-letter hostname
- any other public hostname, including `example.com`, renders `safe`. A safe link whose subdomain spells out another site (`https://paypal.com.secure-login.xyz/verify`) is shown as `Look-alike`; the stored verdict stays `safe`.

Those fixture hostnames do not exist in public DNS. A `malicious` verdict for `malicious.scrutinix.test` is the observation that fixture mode is on. Live VirusTotal, Google Safe Browsing, URLhaus, ThreatFox, Spamhaus, WHOIS, and real DNS are not contacted. A proof of those live providers is `INCONCLUSIVE` in this loop: it needs API keys and network, and this skill does not turn fixture mode off.

`npm run dev` is the README command. The helper adds the fixture flag and share key, binds `127.0.0.1`, and owns the process group it starts. Use the helper.

Logs and state (`VERIFY_STATE_DIR` overrides `/tmp/scrutinix-verify`):

- The state directory is created with mode `0700`. Launch, doctor, and cleanup check it before they read anything in it: a real directory (not a symlink), owned by this user, not group or world accessible. Its path is resolved one component at a time, the way the kernel does: every directory an entry is looked up in, including every directory a symlink's target leads through, must be owned by root or this user and writable by others only when sticky (as `/tmp` is), and every entry on the way, symlinks included, must belong to root or this user. So a symlink of yours inside a world-writable, non-sticky directory is refused, while system links such as macOS `/tmp` → `/private/tmp` pass. Nothing is created under a path that fails. `run.json` and `next-env.json` must be regular files, opened without following symlinks, owned by this user, and not writable by anyone else. If a check fails, the command stops nothing, writes nothing, and exits 2.
- `verify.lock` is the state lock (see "Isolate"). It exists only while a launch or cleanup runs.
- `run.json` records `repoRoot`, `baseUrl`, `port`, the run id and token, the supervisor pid (for diagnostics only; never signal it, and cleanup removes it with the token), and the log paths
- `supervisor.sock` is the supervisor's socket; `supervisor.log` is its own log
- `next.log` is the dev server log, `install.log` and `browsers.log` hold `npm ci` and the Chromium install, and `smoke.log` and `drive.log` hold Playwright's output, with `smoke-report.json` and `drive-report.json` beside them. All are mode `0600`, and none is printed or excerpted: commands print exit statuses, counts, failing test titles, and these paths. A failed launch prints what failed (`npm ci failed`, `next dev exited`, …), how it exited, and the log's path, and nothing from the log. Nothing is redacted, because no subprocess text is ever printed. The raw logs hold whatever the tools wrote. Read them only when you need to, and do not paste them into a PR or a CI log.
- `playwright/smoke/` and `playwright/drive/` hold Playwright's HTML report and traces (see "Drive"); they are raw too
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
- `run.json`, in a state directory that passes its checks, is this checkout's run, and the run's supervisor proves the run token over its socket
- the port is the one that run was given, a process in the supervisor's group holds `127.0.0.1:<port>`, and nothing outside the group listens on that port, before and after the requests

Anything else prints `NOT_READY` and exits 2. Codes:

| Code                | Meaning                                                           |
| ------------------- | ----------------------------------------------------------------- |
| `unreachable`       | Nothing answered on `127.0.0.1:<port>`                            |
| `home-unhealthy`    | Home is up without the scan box, or the status is not 200         |
| `about-unhealthy`   | Home is healthy and `/about` is not                               |
| `privacy-unhealthy` | Home and about are healthy and `/privacy` is not                  |
| `foreign-server`    | The pages look healthy and this skill does not own the server     |
| `foreign-next`      | Another `next dev` holds the port and this skill did not start it |

```bash
node .agents/skills/verify-scrutinix/scripts/doctor.mjs --help
node .agents/skills/verify-scrutinix/scripts/doctor.mjs --json
node .agents/skills/verify-scrutinix/scripts/doctor.mjs --port 3000
```

Doctor prints why the server is or is not owned (`owned by run <id>` with the supervisor and listener pids, or `not owned (<reason>)`), and each listener on the port as `pid, started, executable, cwd`. It finds listeners in `/proc/net/tcp` on Linux and with `lsof` elsewhere (macOS). It never prints a command line or an environment: both can carry tokens. A failed request is reported as a code such as `ECONNREFUSED`, never as an error message. A screenshot taken while doctor is `NOT_READY` is not evidence.

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

Fast path (home, `example.com` taken apart in the field, scan it, read the safe band, the five questions, and the strip, read IndexedDB):

```bash
npm run verify:smoke
```

Feature sweep (every file under `references/features/`):

```bash
npm run verify:drive
```

Both commands run doctor first, against the port recorded for this checkout (or `--port <n>`). If doctor exits 2, the browser does not open.

Playwright's own output (the list reporter, test stdout and stderr, error messages) goes to `smoke.log` or `drive.log`, not to the terminal. Its HTML report and traces embed that raw output, so they go to `playwright/smoke/` or `playwright/drive/` in the private state directory, never to the evidence directory. The command prints Playwright's exit status, the passed, failed, flaky, and skipped counts from its JSON report, the title of each failing test, and the paths of the log, the HTML report, and the traces. A run fails when Playwright writes no JSON report, or when no test ran, whatever its exit status. Read a failure in the HTML report or trace (`npx playwright show-trace <trace.zip>`) locally; do not upload or paste either.

One feature, after doctor is `READY`:

```bash
npm run verify:drive -- -g "batch scan"
```

`npm run verify:smoke -- -g "smoke home"` filters by test title. A title filter (`-g`/`--grep <pattern>`) is the only Playwright argument passed through: another `--config`, a spec path, a reporter, or an output option is refused before Playwright starts, so the suite, the report destinations, and the titles smoke prints are always this skill's own. `--port <n>` is read and not forwarded. Playwright runs with an allowlisted environment: paths, locale, terminal, `CI`, and where browsers are installed, plus what smoke sets itself. Nothing else is inherited (no `PLAYWRIGHT_*` report paths, `PWDEBUG`, `DEBUG_FILE`, `SELENIUM_REMOTE_*`, `NODE_OPTIONS`, or secrets), so nothing in your environment can move a report, write a debug log into the evidence directory, start the inspector, or send the run to a remote browser. The config file is `playwright.config.mjs` next to this skill.

Stable handles:

- Page: heading level 1 `Is this link what it says it is?` on `/` (visually hidden, still in the outline, as soon as the band is on the page, `Checking` included; a shared link's page has the visually hidden h1 `A link shared with you` instead), navigation `Primary` (About, Privacy, the theme button), navigation `Footer` (About, Privacy, Source), link `Skip to content`, link `Scrutinix home` (the wordmark, off the home page only), button `Switch to light theme` or `Switch to dark theme`.
- Form: region `Scan console`, tablist `Scan mode` with tab `Single` and tab `Batch` (its visible hint `up to 10 links` is a description, not part of the name), textbox `URL to analyze`, button `Analyze URL` (visible text `Analyze`), button `Paste` (only where the browser lets a page read the clipboard), textbox `URLs to analyze, one per line`, button `Start batch`, button `Cancel batch`.
- The link, taken apart: region `The link, taken apart` under the field while it holds a checkable link that is not already on screen, with the parts captioned (`Registered domain`, `A label anyone can add`, `A page on that domain`), the sentence `This link belongs to <owner>, not <site>.` for a look-alike, button `Expecting a particular site?`, then textbox `Which site were you expecting?`. On a result the same breakdown sits under the heading `The link, taken apart` (a heading, not a second region).
- Verdict band: region `Scan result: <word>`, where the word is the one shown (`Safe`, `Suspicious`, `Malicious`, `Critical`, `Unknown`, `Error`, `Look-alike`, `Unconfirmed`). Its h2 (`#sx-verdict-heading`) is the word, the registered domain follows in serif, then the instruction, then a last line with the confidence (or a note in its place) and `How scoring works` (an Error band has no last line; a verified shared band has the check time and `Run a fresh scan` there instead). Before there is a word the band is region `Scanning URL` (heading `Checking`, `<n> of 8 checks finished`, button `Cancel scan`) or region `Checking the link's address` (a Safe result waiting for the link parser). Meter `Threat score` (`aria-valuetext` `<n> out of 100`) only where a number means something: never for Unknown, Error, Look-alike, Unconfirmed, or a shared snapshot. Link `How scoring works` goes to `/about#scoring`.
- Evidence: region `Evidence`, switch `Summary Full signal list`, toolbar `Checks` with eight numbered buttons named `<cell>: <finding>` (cells `VirusTotal`, `Link pattern`, `Safe Browsing`, `Threat feeds`, `Certificate`, `Registration`, `DNS`, `Redirects`). Summary is list `Questions`: five `li[data-question]` (`reported`, `destination`, `concern`, `https`, `other`) whose h4s are `Has it been reported?`, `Where would it take me?`, `What else raises concern?`, `Does HTTPS make it safe?`, `What did the other checks find?`. Full is list `Signals`: eight `li[data-signal]` rows labelled `<Label>: <finding>` (`VirusTotal:`, `Link Pattern Model:`, `Google Safe Browsing:`, `Threat Feeds:`, `TLS Certificate:`, `Domain Registration:`, `DNS Profile:`, `Redirect Chain:`); a row with evidence carries the label on its `summary`. An Error result keeps the eight rows on Summary too.
- Result actions: disclosure `How we reached this verdict` (ends `<n>/8 checks · … · cached` on a cache hit, and `Reference: <scan id>` for a failed or partial scan), button `Download result (JSON)`, button `Share`, button `Re-scan`. The live region is `p[aria-live='polite']` in region `Results` (match the region with `exact: true`: `Batch scan results` contains the word): `Result for <host>: <word>, <n> out of 100. <instruction>`, without the score where the band shows none, and with `This link belongs to <owner>, not <site>.` after a Look-alike's instruction or `We couldn't check whether this address imitates another site.` after an Unconfirmed one. The expected-site answer is another polite `p`, so scope to `Results`.
- History: heading `History (<n> scans)`, searchbox `Filter scan history` (visible after more than 3 saved scans), button `Clear all history`, button `Confirm clear all history`, button `Undo clear history`, button `Export history CSV`, button `Export history JSON`. One row per link: a re-scan replaces the earlier entry.
- Shared links: a signed link opens region `Scan result: <word>` with `Verified Scrutinix result · checked … It may be out of date.`, button `Run a fresh scan`, list `Checks` (eight items), then heading `Check another link` over the form. An unsigned or edited one opens region `Shared link, not verified`; a signed one past 3 days opens region `Shared result, expired`; both have heading `Check this shared link yourself` and button `Scan this link`.
- Batch: tabpanel `Batch`, region `Batch scan results` (`Checking links`, `Batch results`, or `Batch stopped`, and `<done>/<total>`), button `Export batch CSV`, button `Export batch JSON`, buttons `Open result for <link>`, the normalized link without its scheme (`Open result for example.org/`, plus ` (look-alike link)` for a look-alike). A Batch chunk that fails to load shows alert `Batch didn't load. Check your connection and try again.` (and `Batch results didn't load. …` in region `Results`, matched with `exact: true`), each with button `Try again`.
- Hooks: `#scan-console`, `#sx-url-input`, `#sx-url-error`, `#sx-analyze`, `#sx-batch-input`, `#sx-verdict-heading`, `#main-content`, `li[data-question]`, `li[data-signal]`.

The dev server allows 10 analyze requests per minute and 50 per day for each client address, counted in process memory for `next dev`. Every drive test presents its own address (`x-real-ip` from `isolateRateLimit`), as `tests/e2e` does, so no test can run into the limit: `verify:smoke` spends 1 scan and no `verify:drive` test spends more than 4. The address is derived from the runner's pid, so two runs within a minute can land on the same one; 1 + 4 still fits. A batch spends one per link. A person driving one browser by hand shares one address.

The full e2e contract remains `npm run test:e2e` (production build, same fixtures and share key). Use it when the change touches a behavior the sweep does not list. `verify:smoke` is the short loop.

## Evidence

Proof artifacts go to the evidence directory (`/tmp/scrutinix-verify/evidence/`, or `VERIFY_EVIDENCE_DIR`). Cleanup never deletes that directory.

- `*.png` screenshots taken by the specs (`smoke-home.png`, `smoke-safe.png`, and the drive shots such as `anatomy-paste.png`, `verdict-look-alike.png`, `share-target-prefilled.png`, and `single-shared-verified.png`; each feature file lists its own)
- `scan.json`, `scan-history.csv`, and `batch.csv` saved from the download the UI produced

Playwright traces and HTML reports are not evidence. They embed raw test output, so they live in the private state directory, under `playwright/<suite>/test-results/` (`trace.zip` per test, trace is `on`) and `playwright/<suite>/report/`. A later smoke run does not delete drive traces, and a later drive run does not delete smoke traces. Read them locally; do not upload, attach, or paste them.

A proof exercises the user path: paste or type a link and read it taken apart, click Analyze or press Enter, read the band and the questions, click a strip cell, switch Summary to Full, open a signal row, export, share and open the shared link, open a `/?url=` link, clear history. Reading `GET /` is the doctor check, not the proof that a scan works.

Capture the action and the end state. Examples: the scan box filled, then region `Scan result: safe`; Clear confirmed, then IndexedDB `scrutinix-v2` has no rows; Undo, then those rows are back.

Side effects worth reading:

- Verdict region accessible name, its h2 word, and meter `aria-valuenow`
- The live region, `p[aria-live='polite']` inside region `Results` (what a screen reader hears when a result lands or is reopened)
- Requests to `/api/analyze`: none while a pasted or arriving link waits for Analyze, exactly one after the tap (`recordScans` in `scripts/support.ts`)
- IndexedDB database `scrutinix-v2`, object store `scans`, field `url` (normalized, so `example.com` is stored as `https://example.com/`)
- Downloaded `scan.json`, `scan-history.csv`, and `batch.csv` contents
- Clipboard text after Share: a `shared` payload and a `sig`, and what each URL opens (verified with `sig`, neutral without), including its `og:image` (`/og/result?shared=…&sig=…` only when verified)
- `localStorage['theme']` and the `class` on `html` after a reload
- Signal detail text that only the fixture provider would produce, such as `Fixture CA` on the TLS row
- Re-scan of the same URL shows `· cached` under `How we reached this verdict` within 15 minutes, for a complete result only (a failed or partial scan is never cached)

The fixture table is the same production orchestrator path with the provider functions replaced. Do not stub the React tree or call the verdict builder from the test. Cancel during an in-flight scan (button `Cancel scan` in the `Scanning URL` band, or Escape in the field) is `INCONCLUSIVE` here: fixture signals resolve before the button is a stable target. Observe Cancel only against a slow live provider, which this loop does not run.

## Cleanup

```bash
npm run verify:cleanup
```

That runs `node .agents/skills/verify-scrutinix/scripts/cleanup.mjs`. It first checks the state directory and `run.json` (see "Logs and state"); if any check fails, it stops nothing and exits 2. It then takes the state lock (exit 2 if another launch or cleanup holds it) and reads `run.json` again. When `run.json` is this checkout's run, cleanup asks the run's supervisor to stop. The supervisor stops the processes still in its process group, `next dev` and whatever `next dev` started that stayed in the group, and exits. Cleanup then checks that the run's socket no longer answers and its port is free.

Cleanup never signals a pid itself. Nothing is stopped by name, pattern, cwd, port, or tmux session. So these are left running, and cleanup says so on stderr and exits 1:

- a socket that cannot prove the run token;
- a `run.json` from the tmux version of this skill (its recorded pids are printed);
- after a stop, anything still answering on the run's socket or port, such as a descendant that left the group with `setsid` or a detached spawn and kept the port. Cleanup reports the stop as incomplete and names the listener as `pid, started, executable, cwd`;
- a listener still on the recorded port once the supervisor is gone (printed the same way). For example, if the supervisor was killed with `SIGKILL`, the app it started is orphaned.

A `run.json` for another checkout is printed and left running.

Cleanup is the only way to stop a run. A pid recorded in `run.json` is never a reason to signal anything: once the supervisor exits, that pid can belong to any process, so cleanup drops it from the record together with the token. When cleanup cannot prove the run token, or something still answers after a stop, it stops nothing more and names what it found. To stop such a process yourself, check its pid, start time, executable, and cwd freshly, as under "Another next dev", and stop only that exact pid.

Cleanup leaves the evidence directory in place and prints that path. It restores `next-env.d.ts` to the snapshot taken at launch only when the file still equals the content this run wrote. If the file differs, cleanup leaves it unchanged, saves the snapshot bytes under the evidence directory, and prints that path. An unfinished snapshot, taken before the run recorded what it wrote, is dropped too, including when `run.json` is missing. After every failed launch or drive, run cleanup before starting again so a half-started session does not keep the port.

Confirm the evidence directory still exists after cleanup before citing it.

## Helpers

| Command                  | Script                                                                          |
| ------------------------ | ------------------------------------------------------------------------------- |
| `npm run verify:launch`  | `scripts/launch.mjs`                                                            |
| `npm run verify:doctor`  | `scripts/doctor.mjs`                                                            |
| `npm run verify:smoke`   | `scripts/smoke.mjs` (doctor, then `smoke.spec.ts`, through `scripts/suite.mjs`) |
| `npm run verify:drive`   | `scripts/smoke.mjs --drive` (doctor, then `drive.spec.ts`)                      |
| `npm run verify:cleanup` | `scripts/cleanup.mjs`                                                           |
| `npm run verify:check`   | `scripts/runtime.check.mjs` (the skill's own tests)                             |

```bash
node .agents/skills/verify-scrutinix/scripts/launch.mjs --help
node .agents/skills/verify-scrutinix/scripts/doctor.mjs --help
node .agents/skills/verify-scrutinix/scripts/smoke.mjs --help
node .agents/skills/verify-scrutinix/scripts/cleanup.mjs --help
```

`npm run verify:check` runs in under a minute and needs no server. It starts its own supervisors, stand-in apps, and stranger processes on free ports in private scratch directories under `/tmp`. Each stranger must survive every cleanup. It stops only what it started, by the handles it holds: supervisors and direct children through their `ChildProcess` handles, and every stand-in (fake apps and their children, strangers, sleepers, and the fake `next dev`) through a lifeline, a socket connection to the check that the stand-in exits on when it closes. If the check throws, it tears down on exit; if it is killed, every lifeline closes, every stand-in exits, and each supervisor follows 10 seconds after its app. It never signals a saved pid or process group. A failing check prints its name and selected fields only (numbers, booleans, null); any string, array, or object prints as its kind and size, so no captured output, `run.json`, or run token reaches the terminal. It runs the smoke runner with a stand-in Playwright only by passing it to `runSuite` in `scripts/suite.mjs`; `smoke.mjs` always runs the real one. Its refusal tests run against a state directory every command refuses, so a broken guard fails the check instead of launching anything, and it keeps its scratch directory, and fails, if any supervisor there still answers.

`scripts/supervisor.mjs` is the run supervisor; launch starts it, and nothing else should. `scripts/evidence.ts` writes screenshots and downloads into `VERIFY_EVIDENCE_DIR`. `scripts/support.ts` holds the shared Playwright steps (`gotoApp`, `waitForHydration`, `fillSingle`, `scanSingle`, `historyState`, `recordScans`, `launchFromShareSheet`) and re-exports `isolateRateLimit` and `setDefaultTextSize` from `tests/e2e/helpers.ts`.

## How to report

Every pull request, Dependabot's included, carries a Proof section in its body, written for the head that will merge and in place before the merge. Most merges in the [Dependabot proof audit](../../../docs/agents/dependabot-proof-audit.md) and the [feedback census](../../../docs/agents/feedback-census.md) had no Proof, or one that named an earlier commit or was posted after the merge. A Proof like that covers nothing.

The contract:

1. **Head SHA.** The full 40-character `gh pr view <n> --json headRefOid` value, not a prefix, and not the squash commit on `main`.
2. **Audit and Verify job URLs.** Links to the `Audit` and `Verify` jobs (`…/actions/runs/<run>/job/<job>`) whose head SHA is that commit and whose conclusion is `success`. A job that is still running, or that ran on an earlier commit, is not proof.
3. **Greptile status for that head.** Clean pass (0 comments), the findings and how each was settled, or skipped and why. A skip (excluded author, budget) is not a pass. Neither is a green CodeRabbit check that says skipped, rate limited, or no files to review.
4. **Evidence or `INCONCLUSIVE`.** The commands you ran, a result for each, and evidence paths under the evidence directory that still exist after cleanup. Any step that could not run is `INCONCLUSIVE`, with the reason. A dependency bump with no UI change can say `INCONCLUSIVE: no product change to drive` and rest on Verify.
5. **Posted before merge.** In the body, earlier than the merge. A new commit makes the old Proof stale: replace it for the new head, and don't leave the old SHA behind.

The `Proof` check (`.github/workflows/proof.yml`, `scripts/check-pr-proof.mjs`) fails until the body has a heading starting with `Proof` whose section quotes the current head SHA in full. Text inside an HTML comment does not count, because it doesn't render. The check re-runs when the body is edited. It does not read the links, Greptile, or the evidence, so meeting the rest of the contract is on whoever merges. It also cannot protect itself. Under `pull_request`, a PR runs its own copy of `proof.yml` and `check-pr-proof.mjs`, so a PR that edits either one can make its own check pass. Review any diff to those two files as a change to the gate. `CODEOWNERS` now covers the guard: `@amanthanvi` owns `.github/workflows/proof.yml`, `scripts/check-pr-proof.mjs`, `tests/unit/check-pr-proof.test.ts`, and `.github/CODEOWNERS`. Code-owner review is being turned on in the `fleet-merge-gate` ruleset, done separately by Aman's steward and not in the pull request that added the file. Every fleet PR is authored as amanthanvi and GitHub ignores an author's own approval, so with code-owner review required, a PR touching the guard files needs Aman to merge it through his admin bypass. That's intended. Dependabot writes its own body and rewrites it whenever it rebases, which also changes the head. The merging agent appends the Proof to the end of Dependabot's body once Audit and Verify pass on that head, and adds it again after any rebase.

```markdown
### Proof

- Head: `<40-character head SHA>`
- Audit: <job URL for that head> (success)
- Verify: <job URL for that head> (success)
- Greptile: clean pass on that head | <findings and how each was settled> | skipped (<reason>)
- Commands: the exact commands, including `npm run verify:doctor` and the drive you ran
- Evidence: screenshot and download paths under the evidence directory that still exist after cleanup
- Results: pass or fail per command, plus the observable end state (URL, verdict region, IndexedDB, download, clipboard, theme)
- INCONCLUSIVE: any step that could not run, and the concrete reason (port busy, browser missing, fixture mode required, live provider keys absent, rate limit window)
```

After a squash merge, confirm the push run on the new `main` SHA. The Proof names the pull request head, not that commit.

A missing check is `INCONCLUSIVE`. Do not describe it as passed. Do not paste raw logs (`next.log`, `install.log`, `browsers.log`, `smoke.log`, `drive.log`), the Playwright HTML report, traces, or process command lines into the report.

## Feature map

[`references/features/README.md`](references/features/README.md) is the sweep order. Each feature file has the same four headings: Sub-features, How to get to it (user POV), Driving it with Playwright, Gotchas.
