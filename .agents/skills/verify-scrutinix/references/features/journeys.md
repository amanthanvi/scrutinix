# Journeys

Cross-page paths. Use this after the single-feature files when a change touches scan, history, and share together.

## Sub-features

- paste-then-scan: a pasted link is taken apart before any request, and one tap on Analyze makes exactly one scan
- arrive-then-scan: a link that arrives through `/?url=` or the share target waits, filled in, for that tap
- scan-then-history: a finished scan is still in IndexedDB after reload, and opening it moves focus to its verdict
- scan-then-share: Share copies a signed link that opens recipient-first and verified; the same payload unsigned opens the neutral band
- public-pages: About, Privacy, and the wordmark back to the scanner leave history in place, and the band's `How scoring works` opens `/about#scoring`
- budget: each drive test uses its own rate-limit client address

## How to get to it (user POV)

Paste a link: it is taken apart under the field. Analyze it. Reload: the row is still under History. Click Share and open the copied link: the verified result leads, `Check another link` follows. Remove `sig` and the page asks you to check the link yourself. Open a `/?url=` link: the link is filled in and waits for Analyze. Visit About, then Privacy, then the wordmark. The scanner is back. History is still on this device.

## Driving it with Playwright

`npm run verify:drive` walks these in separate tests so each one starts from a known empty context:

1. `site chrome and theme` proves the headline, keyboard order, theme persistence, and the 404.
2. `about and privacy` proves the methodology page, the privacy sections, and the wordmark, with no scan.
3. `hostile and empty inputs` proves every refusal, and that nothing is taken apart, requested, or saved.
4. `legacy history migration` proves the old database moves over and opens with its note.
5. `single scan share and rescan` proves scan, the five questions, Full, export, a re-scan that reaches the server and is cached, one history row per link, the signed link opening recipient-first, and the unsigned link opening neutral.
6. `verdicts and history` proves Malicious, Unknown, and a feed listing, the strip leading to questions and rows, four saved URLs surviving reload, filter, export, reopening with focus and announcement, clear and undo, and the four rows surviving About, Privacy, and the wordmark.
7. `link taken apart on paste, then a look-alike` proves the breakdown and `Expecting a particular site?` before any request, then `Look-alike`.
8. `error and critical verdicts` proves Error with its reference, Critical, and the band's link to `/about#scoring`.
9. `an address check that fails to load reads Unconfirmed` proves a Safe result is never shown as Safe without its address check.
10. `sharing to Scrutinix fills in the link and waits for Analyze` proves `/?url=` and `POST /share` scan nothing until the tap.
11. `batch scan` proves two more URLs land in IndexedDB and Open returns to Single.
12. `a Batch panel that fails to load retries in place` proves the lazy panel's failure and recovery.
13. `larger default text reflows without sideways scrolling` proves 200% text on a 320px phone.

Each test presents its own client address to the rate limiter (`isolateRateLimit`), so the sweep fits the dev server's 10 per minute per-client limit; no test spends more than 4. A reviewer who drives one browser context by hand shares one address, and should keep to 10 scans a minute.

## Gotchas

- Tests do not share IndexedDB. A history assertion has to scan inside the same test that reads the database.
- Restarting the dev server clears the result cache and the in-memory rate-limit windows. It does not clear the browser. Playwright contexts are already fresh.
- Live provider journeys are `INCONCLUSIVE` without keys. Stay on the fixture hostnames.
- `npm run test:e2e` is the production-build suite. It is the right extra step when the change is in rendering, chunking, or caching that `next dev` might hide (the bundle split, the held link parser, the reflow matrix). It is not required to prove this map.
