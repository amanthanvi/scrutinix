# Share and re-scan

Copy a signed link to the current verdict, then run the same URL again.

## Sub-features

- share: button `Share` copies a URL with `shared` (the payload) and `sig` (the server's signature) query parameters
- verified: a signed link opens as the verdict with `Verified Scrutinix result · checked …`, without a new scan
- unverified: the same payload without a valid `sig` opens the neutral band `Check this shared link yourself`, with no verdict, score, summary, or strip
- rescan: button `Re-scan` on a finished result, `Run a fresh scan` on a verified share, `Scan this link` on the neutral band
- cache: a repeat of the same URL within 15 minutes is marked `· cached`

## How to get to it (user POV)

After a verdict, click Share. The toast says the link was copied and that it stays verifiable for 3 days. Paste it in a new tab. The page shows the verdict band with `Verified Scrutinix result · checked …` and `Run a fresh scan`. Anyone can write a `?shared=` payload, so a link without Scrutinix's signature (or with an edited payload) opens a neutral band instead: `Check this shared link yourself` and `Scan this link`. On a live result, `Re-scan` runs the URL again. A cached repeat says so under `How we reached this verdict`.

## Driving it with Playwright

`npm run verify:drive` test `single scan share and rescan`.

1. Scan `example.com` until `Scan result: safe`.
2. Click `Re-scan`.
3. Open `How we reached this verdict` and expect `· cached`.
4. IndexedDB `scans` holds `https://example.com/` once. History keeps one row per link, so the re-scan replaces the first entry. The heading reads `History (1 scan)`.
5. Click `Share`. Read `navigator.clipboard.readText()`. Expect a `shared` parameter and a 43-character base64url `sig`.
6. `page.goto` that URL. Expect region `Scan result: safe` with `Verified Scrutinix result · checked`.
7. `page.goto` the same `shared` value without `sig`. Expect label `Shared link, not verified`, heading `Check this shared link yourself`, button `Scan this link`, and no `Scan result` region, meter, or `Verified Scrutinix result`.

Screenshots: `single-rescan.png`, `single-shared-verified.png`, `single-shared-unsigned.png`.

Signing needs a key. `verify:launch` starts `next dev` with `SCRUTINIX_TEST_FIXTURES=1` and the published e2e key, exactly as `scripts/run-e2e.mjs` does. `lib/config/env.ts` accepts only that key in fixture mode, and refuses it outside fixture mode, so this loop never uses or needs a real key. Do not set `SHARE_SIGNING_SECRET` yourself for this loop.

The drive does not also click `Run a fresh scan`. That button calls the same rescan path and would spend another analyze request. One re-scan plus the two share navigations is the proof.

Grant `clipboard-read` and `clipboard-write` on the context. `verify:drive` does this.

## Gotchas

- A toast that says the link was copied is not the proof. The verified band on the copied URL, and the neutral band on the unsigned one, are the proof.
- A verified share expires 72 hours after it was captured. An expired link opens the neutral band with `Shared result, expired`. The drive opens the link immediately.
- Editing any character of a signed payload makes it unverified. A payload that does not decode at all (`?shared=not-a-snapshot`) renders the plain scanner. That case lives in input validation.
- Share does not write the server. There is no share database to query.
- The result cache is process memory on the dev server. Cleanup and a new launch forget it. A re-scan after a fresh launch is not cached.
- Clipboard permission is a browser context setting. A drive without it fails the read, which is a harness gap, not a product failure.
