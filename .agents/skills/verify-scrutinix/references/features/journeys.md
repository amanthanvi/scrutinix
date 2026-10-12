# Journeys

Cross-page paths. Use this after the single-feature files when a change touches scan, history, and share together.

## Sub-features

- scan-then-history: a finished scan is still in IndexedDB after reload
- scan-then-share: Share copies a snapshot, and opening it leaves the saved scans in place
- public-pages: About and Privacy do not clear history, and the wordmark returns to the scanner
- budget: smoke plus the sweep stay inside the dev rate limit

## How to get to it (user POV)

Scan a URL. Reload. The row is still under History. Click Share and open the copied link. The snapshot is on screen and History still lists the scan. Visit About, then Privacy, then the wordmark. The scanner is back. History is still on this device.

## Driving it with Playwright

`npm run verify:drive` already walks this in separate tests so each one starts from a known empty context:

1. `about and privacy` proves the public pages and the wordmark, with no scan.
2. `single scan share and rescan` proves scan, re-scan cache, clipboard payload, and that a navigation to the shared URL keeps IndexedDB.
3. `verdicts and history` proves four saved URLs survive reload, then clear and undo.
4. `batch scan` proves two more URLs land in IndexedDB and Open returns to Single.

Do not add another scan-heavy journey on top of `verify:drive` in the same minute. The sweep already uses 8 analyze requests. `verify:smoke` uses 1 more. The process allows 10 per minute.

A reviewer who wants one browser context for the whole journey can run the tests above in order and stop before a ninth URL.

## Gotchas

- Tests do not share IndexedDB. A history assertion has to scan inside the same test that reads the database.
- Restarting the dev server clears the result cache and the rate-limit window. It does not clear the browser. Playwright contexts are already fresh.
- Live provider journeys are `INCONCLUSIVE` without keys. Stay on the fixture hostnames.
- `npm run test:e2e` is the production-build suite. It is the right extra step when the change is in rendering or caching that `next dev` might hide. It is not required to prove this map.
