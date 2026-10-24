# Journeys

Cross-page paths. Use this after the single-feature files when a change touches scan, history, and share together.

## Sub-features

- scan-then-history: a finished scan is still in IndexedDB after reload
- scan-then-share: Share copies a signed link that opens verified; the same payload unsigned opens the neutral band
- public-pages: About and Privacy do not clear history, and the wordmark returns to the scanner
- budget: each drive test uses its own rate-limit client address

## How to get to it (user POV)

Scan a URL. Reload. The row is still under History. Click Share and open the copied link. The verified result is on screen. Remove `sig` and the page asks you to check the link yourself. Visit About, then Privacy, then the wordmark. The scanner is back. History is still on this device.

## Driving it with Playwright

`npm run verify:drive` already walks this in separate tests so each one starts from a known empty context:

1. `about and privacy` proves the public pages and the wordmark, with no scan.
2. `single scan share and rescan` proves scan, re-scan cache, one history row per link, the signed link opening verified, and the unsigned link opening neutral.
3. `verdicts and history` proves four saved URLs survive reload, then clear and undo.
4. `batch scan` proves two more URLs land in IndexedDB and Open returns to Single.

Each test presents its own client address to the rate limiter (`isolateRateLimit`), so the sweep fits the dev server's 10 per minute per-client limit. A reviewer who drives one browser context by hand shares one address, and should keep to 10 scans a minute.

## Gotchas

- Tests do not share IndexedDB. A history assertion has to scan inside the same test that reads the database.
- Restarting the dev server clears the result cache and the in-memory rate-limit windows. It does not clear the browser. Playwright contexts are already fresh.
- Live provider journeys are `INCONCLUSIVE` without keys. Stay on the fixture hostnames.
- `npm run test:e2e` is the production-build suite. It is the right extra step when the change is in rendering or caching that `next dev` might hide. It is not required to prove this map.
