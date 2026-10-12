# Share and re-scan

Copy a link that embeds the current verdict, then run the same URL again.

## Sub-features

- share: button `Share` writes a URL with a `shared` query parameter
- snapshot: opening that URL shows the embedded verdict without a new scan
- rescan: button `Re-scan` on a finished result, and `Run fresh scan` on a snapshot
- cache: a repeat of the same URL within 15 minutes is marked cached

## How to get to it (user POV)

After a verdict, click Share. The toast says the link was copied. Paste it in a new tab. The page shows the verdict, the URL, and `Shared snapshot`, plus `Run fresh scan`. On a live result, `Re-scan` runs the URL again. A cached repeat says so under Details.

## Driving it with Playwright

`npm run verify:drive` test `single scan share and rescan`.

1. Scan `example.com` until `Scan result: safe`.
2. Click `Re-scan`.
3. Open `Details` and expect `cached`.
4. IndexedDB `scans` contains `https://example.com/` twice (a new scan id, not an overwrite).
5. Click `Share`. Read `navigator.clipboard.readText()`.
6. Decode `shared`: `JSON.parse(decodeURIComponent(atob(value)))`. Expect `url` `https://example.com/` and `verdict` `safe`.
7. `page.goto` that clipboard URL. Expect `Shared snapshot` and `example.com`. IndexedDB still contains the earlier URL, because the snapshot page does not delete history.

Screenshots: `single-rescan.png`, `single-shared.png`.

The drive does not also click `Run fresh scan`. That button calls the same rescan path and would spend another analyze request. One re-scan plus the snapshot navigation is the proof.

Grant `clipboard-read` and `clipboard-write` on the context. `verify:drive` does this.

## Gotchas

- A toast that says the link was copied is not the proof. The decoded clipboard payload is the proof.
- `?shared=not-a-snapshot` renders the empty scanner. That case lives in input validation.
- Share does not write the server. There is no share database to query.
- The result cache is process memory on the dev server. Cleanup and a new launch forget it. A re-scan after a fresh launch is not cached.
- Clipboard permission is a browser context setting. A drive without it fails the read, which is a harness gap, not a product failure.
