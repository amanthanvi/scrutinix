# Single scan

Analyze one URL and read the verdict.

## Sub-features

- submit: Analyze button or Enter in the field
- streaming: the band reads `Checking` with `<n> of 8 checks finished` and a `Cancel scan` button (region `Scanning URL`); the strip fills cell by cell and the five questions hold their place, answering as checks land; Analyze is `aria-disabled` and Escape cancels
- verdict: region `Scan result: <word>`, its h2 the word, the registered domain in serif under it, then one instruction; meter `Threat score` where a number means something
- landing: focus stays on the band's heading after Re-scan, and a verdict that lands below the fold is scrolled fully into view
- export: `scan.json` download (button `Download result (JSON)`, toast `Downloaded scan.json`)
- history: the finished scan is saved on this device

## How to get to it (user POV)

Open `/`. The Single tab is selected. Paste or type a URL into the box whose name is `URL to analyze`; it is taken apart under the box at once (`link-anatomy.md`). Click Analyze, or press Enter. For a clean link the band reads `Safe`, `example.com` under it, and `Looks safe to open.`, with the score and its band (`Safe band 0–24`) on the right and `High confidence · How scoring works` on its last line. `Download result (JSON)` saves the result. The URL also appears under History after the scan finishes. Analyze steps back to an outline button while a result for the field's link is shown, and on a phone `Paste` steps aside so the field and Analyze share a row.

## Driving it with Playwright

`npm run verify:smoke` covers the safe path. `npm run verify:drive` test `single scan share and rescan` covers export, the five questions, Full, and the TLS detail.

```ts
await fillSingle(page, "example.com");
await page.getByRole("button", { name: "Analyze URL" }).click();
const verdict = page.getByRole("region", { name: /^scan result: safe$/i });
await expect(verdict).toBeVisible();
await expect(
  verdict.getByRole("heading", { level: 2, name: "Safe" }),
).toBeVisible();
```

Side effects:

- The region contains `Looks safe to open.` and the registered domain `example.com` (the line under the word).
- The meter `aria-valuenow` is between 0 and 24 for this fixture.
- IndexedDB `scrutinix-v2` / `scans` contains `https://example.com/`.
- The `Download result (JSON)` download contains that same URL. The file is saved as `scan.json` in the evidence directory.

Screenshots: `smoke-home.png`, `smoke-safe.png`, `single-safe.png`.

## Gotchas

- Fill the box inside `expect(...).toPass()`. A fill before hydration can be wiped.
- The visible button text is `Analyze`. The accessible name is `Analyze URL`. It is never disabled at rest: an empty submit shows `Paste a link to check.`
- Fixture scans finish quickly. Cancel is `INCONCLUSIVE` in this loop because the button is not a stable target. Do not fail a drive for a missing `Cancel scan` control on `example.com`.
- A Safe band waits for the link parser before it states a word (region `Checking the link's address`), because the same scan may be a look-alike. Wait on the final region name, not on the first band you see.
- The first scan after launch compiles the analyze route and can take longer than later scans. Assertions wait 20 seconds by default, so the specs give a scan 60 seconds to land (`SCAN_TIMEOUT_MS` in `scripts/support.ts`); the whole test may take 180.
- `example.com` is safe only because fixtures are on. Doctor does not prove that. This verdict does.
