# Scrutinix feature map

Behavior-level inventory of the public Scrutinix scanner. Agents use this map to decide what to drive and what evidence counts. The list below is the regression sweep order.

The app is one centered column: scan form, verdict, signal rows, history. Method notes live on `/about`. Privacy notes live on `/privacy`.

## Baseline preconditions

- Doctor reports `READY` on `http://127.0.0.1:3000` for a server `verify:launch` started.
- That server has `SCRUTINIX_TEST_FIXTURES=1`. Live provider proofs are `INCONCLUSIVE` in this loop.
- Prefer roles, accessible names, and the ids in the skill. Class selectors are a fallback.
- Wait on the verdict region, history text, or IndexedDB rows. Do not sleep for a fixed time.
- Each Playwright test gets a fresh browser context. IndexedDB and theme do not carry across tests.
- The dev server allows 10 analyze requests per minute and 50 per day. `verify:smoke` uses 1. `verify:drive` uses 8. Running both in one minute uses 9.

## Proof and skip reporting

For a fix or feature, the relevant feature file defines the coverage set. When a change spans scan, history, and share, also read `journeys.md`.

- Exercise every reachable entry point the change can affect, including success, empty, error, and hostile inputs listed in that file.
- Record the action and the final observable state.
- Fixture mode is the production orchestrator with provider functions swapped. It counts. Stubbing the React tree does not.
- When a path is unreachable, name it and the concrete prerequisite. Live provider keys, and Cancel on an instant fixture scan, are `INCONCLUSIVE` here.

## Full sweep

Walk this map top to bottom. `npm run verify:drive` covers every file. Finish with `journeys.md`.

## Chrome

- [site-chrome](site-chrome.md): Skip link, header, footer, unknown paths.
- [theme](theme.md): Light and dark toggle, persisted in `localStorage`.

## Pages

- [about](about.md): Scoring, bands, and how to use the scanner.
- [privacy](privacy.md): What stays on the device, what the server processes, shared links.

## Scanner

- [input-validation](input-validation.md): Empty, hostile, private, and over-long URLs. Batch cap.
- [single-scan](single-scan.md): One URL, Analyze, verdict, export JSON.
- [verdict-and-signals](verdict-and-signals.md): Summary and Full rows, fixture verdicts, signal details.
- [share-and-rescan](share-and-rescan.md): Share link, clipboard payload, re-scan cache hit.
- [history](history.md): IndexedDB history, filter, export, clear, undo, legacy migration.
- [batch-scan](batch-scan.md): Up to 10 URLs, batch export, open a row.

## Journeys

- [journeys](journeys.md): Scan, history, share, and the public pages in one pass. Rate-limit budget.

## Entry contract

Every feature file uses the same four H2s:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with Playwright`
4. `Gotchas`
