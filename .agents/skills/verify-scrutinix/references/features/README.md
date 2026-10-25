# Scrutinix feature map

Behavior-level inventory of the public Scrutinix scanner. Agents use this map to decide what to drive and what evidence counts. The list below is the regression sweep order.

The home page is one centered column: the headline `Is this link what it says it is?`, the scan form (with the link in the field taken apart below it), then, once a scan runs, the verdict band, the link taken apart, Evidence (the numbered eight-cell strip over Summary's five questions or Full's eight rows), `How we reached this verdict`, the result actions, and history. A shared result link puts the result first and the form under `Check another link`. The method, with every weight and rule, lives on `/about`. Privacy notes live on `/privacy`.

## Baseline preconditions

- Doctor reports `READY` on the port `verify:launch` recorded for this checkout (default `127.0.0.1:3000`).
- That server has `SCRUTINIX_TEST_FIXTURES=1` and the published e2e share key from `scripts/run-e2e.mjs`. Live provider proofs are `INCONCLUSIVE` in this loop.
- Prefer roles, accessible names, and the ids in the skill. Class selectors are a fallback.
- Wait on the verdict region, history text, or IndexedDB rows. Do not sleep for a fixed time. The one exception is proving that nothing happened (no scan after a link arrives): that needs a short window to watch, and the drive uses one second.
- Each Playwright test gets a fresh browser context. IndexedDB and theme do not carry across tests.
- The dev server allows 10 analyze requests per minute and 50 per day for each client. Every drive test presents its own client address (`isolateRateLimit` from `tests/e2e/helpers.ts`), so `verify:smoke` and `verify:drive` stay under it. A hand-driven browser does not.

## Proof and skip reporting

For a fix or feature, the relevant feature file defines the coverage set. When a change spans scan, history, and share, also read `journeys.md`.

- Exercise every reachable entry point the change can affect, including success, empty, error, and hostile inputs listed in that file.
- Record the action and the final observable state.
- Fixture mode is the production orchestrator with provider functions swapped. It counts. Stubbing the React tree does not. Failing a chunk request with `page.route` (the link parser, the Batch panel) is a real network failure the app has to survive; it counts too.
- When a path is unreachable, name it and the concrete prerequisite. Live provider keys, and Cancel on an instant fixture scan, are `INCONCLUSIVE` here.

## Full sweep

Walk this map top to bottom. `npm run verify:drive` covers every file. Finish with `journeys.md`.

## Chrome

- [site-chrome](site-chrome.md): Skip link, header, keyboard order, footer, unknown paths.
- [theme](theme.md): Light and dark toggle, persisted in `localStorage`.
- [larger-text](larger-text.md): 200% default text on a 320px phone, no sideways scrolling.

## Pages

- [about](about.md): The open methodology: scoring tables, bands, rules, confidence, the eight cells, the name.
- [privacy](privacy.md): What stays on the device, what the server processes, shared links, sharing to Scrutinix.

## Scanner

- [input-validation](input-validation.md): Empty, hostile, private, and over-long URLs. Batch cap.
- [link-anatomy](link-anatomy.md): The link taken apart as you paste it, `Expecting a particular site?`, and the hand-over to the result.
- [single-scan](single-scan.md): One URL, Analyze, the band, download JSON.
- [verdict-and-signals](verdict-and-signals.md): Every verdict word (including `Look-alike` and `Unconfirmed`), the five questions, the numbered strip, Full rows, error references.
- [share-and-rescan](share-and-rescan.md): Signed share link, verified, unverified, and expired views, re-scan cache hit.
- [sharing-to-scrutinix](sharing-to-scrutinix.md): `/?url=` and the Android share target (`POST /share`) fill in the link and wait for Analyze.
- [history](history.md): IndexedDB history (one row per link), filter, export, clear, undo, legacy migration.
- [batch-scan](batch-scan.md): Up to 10 URLs, batch export, open a row, and the lazily loaded panel's in-place retry.

## Journeys

- [journeys](journeys.md): Scan, history, share, and the public pages in one pass. Rate-limit budget.

## Entry contract

Every feature file uses the same four H2s:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with Playwright`
4. `Gotchas`
