# Verdict and signals

The verdict, the threat-score meter, and the eight signal rows. Summary shows the strongest rows. Full shows every row. A row with details opens as a disclosure.

## Sub-features

- verdicts: `safe`, `malicious`, `unknown` from fixture hostnames
- summary-full: switch `Show full signal list`
- disclosure: signal label plus status, then detail pairs
- meter: `Threat score` with `aria-valuenow`

## How to get to it (user POV)

Run a scan. The verdict word is the heading of region `Scan result: <verdict>`. The meter sits on the same row. Under it, Summary is the default. Click the Summary / Full switch to see every signal. Click a row that has a chevron to read the evidence pairs.

Fixture URLs, typed as a person would:

- `example.com` shows `safe`, with `No direct malicious indicators were found in the completed signals.`
- `https://malicious.scrutinix.test/login` shows `malicious` and a VirusTotal row about engine flags
- `https://unreachable.scrutinix.test/` shows `unknown` and the sentence that an unreachable host is not evidence of safety
- `https://feed-hit.scrutinix.test/payload.exe` shows `malicious` and a threat-feed match

## Driving it with Playwright

`npm run verify:drive` tests `single scan share and rescan` and `verdicts and history`.

```ts
await scanSingle(page, "https://malicious.scrutinix.test/login", "malicious");
const signalView = page.getByRole("switch", { name: "Show full signal list" });
await signalView.click();
await page.getByLabel(/TLS Certificate signal:/i).click();
await expect(page.getByText("Fixture CA")).toBeVisible();
```

`Fixture CA` is fixture TLS data rendered in the disclosure. That string is the side effect that the signal payload reached the screen.

On a safe scan, DNS Profile and Redirect Chain stay absent while the switch is off (`aria-checked="false"`), and DNS Profile is present after it is on.

Screenshots: `verdict-malicious.png`, `verdict-unknown.png`, `verdict-feed.png`, `single-safe.png`.

## Gotchas

- Summary order follows severity, then a fixed priority. Do not require a specific three names on a malicious scan. Do require VirusTotal or Threat Feeds when that fixture is the conviction.
- `unknown` must not present a `Scan result: safe` region. Absence of findings is not a safe verdict.
- Signal accessible names look like `VirusTotal signal: success`. Match with a prefix.
- There is no `critical` fixture hostname. Do not invent one.
- Opening Details on the verdict (the word `Details`) shows recommendations and, after a re-scan, the word `cached`. That is the share-and-rescan check.
