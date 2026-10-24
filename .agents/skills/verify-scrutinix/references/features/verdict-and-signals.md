# Verdict and signals

The verdict band, the threat-score meter, the eight-cell strip, and the eight signal rows. Summary shows the rows that drove the verdict (or one quiet line when none did). Full shows every row. A row with details opens as a disclosure.

## Sub-features

- verdicts: `safe`, `malicious`, `unknown` from fixture hostnames
- summary-full: switch `Summary Full signal list` (`aria-checked` false on Summary)
- disclosure: signal label plus status, then detail pairs
- meter: `Threat score` with `aria-valuenow`

## How to get to it (user POV)

Run a scan. The verdict word is the heading of region `Scan result: <verdict>`. The meter sits on the same row. Under it, Summary is the default. Click the Summary / Full switch to see every signal. Click a row that has a chevron to read the evidence pairs.

Fixture URLs, typed as a person would:

- `example.com` shows `safe`, with `Looks safe to open.` and, on Summary, `All 8 checks found nothing.`
- `https://malicious.scrutinix.test/login` shows `malicious`, `Don't open this link.`, and a VirusTotal row: `7 engines flagged this link as malicious, 2 as suspicious.`
- `https://unreachable.scrutinix.test/` shows `unknown`, `We couldn't check this link — treat it as unsafe.`, and no threat-score meter
- `https://feed-hit.scrutinix.test/payload.exe` shows `malicious` and the Threat Feeds row `URLhaus lists this link as active malware distribution.`

## Driving it with Playwright

`npm run verify:drive` tests `single scan share and rescan` and `verdicts and history`.

```ts
await scanSingle(page, "https://malicious.scrutinix.test/login", "malicious");
const signalView = page.getByRole("switch", {
  name: "Summary Full signal list",
});
await signalView.click();
await page.getByLabel(/TLS Certificate signal:/i).click();
await expect(page.getByText("Fixture CA")).toBeVisible();
```

`Fixture CA` is fixture TLS data rendered in the disclosure. That string is the side effect that the signal payload reached the screen.

On a safe scan, Summary shows `All 8 checks found nothing.` and no signal rows while the switch is off (`aria-checked="false"`). DNS Profile is present after it is on.

Screenshots: `verdict-malicious.png`, `verdict-unknown.png`, `verdict-feed.png`, `single-safe.png`.

## Gotchas

- Summary order follows severity, then a fixed priority. Do not require a specific three names on a malicious scan. Do require VirusTotal or Threat Feeds when that fixture is the conviction.
- `unknown` must not present a `Scan result: safe` region. Absence of findings is not a safe verdict.
- Signal accessible names look like `VirusTotal signal: No engines flagged this link.` Match with a prefix.
- There is no `critical` fixture hostname. Do not invent one.
- `How we reached this verdict` opens the reasons and the check line; after a re-scan it ends with `· cached`. That is the share-and-rescan check.
- A source that found nothing is `clear` (gray), never green. Each strip state has its own shape. Do not assert colours.
