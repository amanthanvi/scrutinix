# Single scan

Analyze one URL and read the verdict.

## Sub-features

- submit: Analyze button or Enter
- streaming: the box shows Cancel while a scan is in flight
- verdict: region `Scan result: <verdict>` and meter `Threat score`
- export: `scan.json` download

## How to get to it (user POV)

Open `/`. The Single tab is selected. Type a URL into the box whose name is `URL to analyze`. Click Analyze, or press Enter. The verdict replaces the empty column. Export JSON downloads the result. The URL also appears under History after the scan finishes.

## Driving it with Playwright

`npm run verify:smoke` covers the safe path. `npm run verify:drive` test `single scan share and rescan` covers export and the TLS detail.

```ts
await fillSingle(page, "example.com");
await page.getByRole("button", { name: "Analyze URL" }).click();
const verdict = page.getByRole("region", { name: /^scan result: safe$/i });
await expect(verdict).toBeVisible();
```

Side effects:

- The region contains `example.com`.
- The meter `aria-valuenow` is between 0 and 24 for this fixture.
- IndexedDB `scrutinix-v2` / `scans` contains `https://example.com/`.
- The Export JSON download contains that same URL. The file is saved as `scan.json` in the evidence directory.

Screenshots: `smoke-home.png`, `smoke-safe.png`, `single-safe.png`.

## Gotchas

- Fill the box inside `expect(...).toPass()`. A fill before hydration can be wiped.
- The visible button text is `Analyze`. The accessible name is `Analyze URL`.
- Fixture scans finish quickly. Cancel is `INCONCLUSIVE` in this loop because the button is not a stable target. Do not fail a drive for a missing Cancel control on `example.com`.
- The first scan after launch compiles the analyze route and can take longer than later scans. The Playwright timeout is 180 seconds.
- `example.com` is safe only because fixtures are on. Doctor does not prove that. This verdict does.
