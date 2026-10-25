# Verdict and signals

The verdict band, the threat-score meter, the numbered eight-cell strip, Summary's five questions, Full's eight check rows, and the reasoning under `How we reached this verdict`.

## Sub-features

- band: region `Scan result: <word>`; h2 the word, the registered domain in serif under it, one instruction, then a last line (confidence, or a note in its place) with `How scoring works`. An Error band has no last line; a verified shared band has its check time and `Run a fresh scan` there instead. The band is the only tinted container; its tone follows the word shown, the word itself stays ink.
- words: `Safe`, `Suspicious`, `Malicious`, `Critical`, `Unknown`, `Error`, plus two presentation words for a Safe result:
  - `Look-alike`: the link spells out another site. Instruction `Don't sign in or enter details here.`, no meter, and in place of confidence `No check flagged it, but the name is misleading.` (or `The checks found nothing serious, but the name is misleading.` when some finding scored); the details state `No check flagged it: on their own, the checks scored it Safe, <n> out of 100.` (or `On their own, the checks scored it Safe, <n> out of 100.`)
  - `Unconfirmed`: the link parser that spots look-alikes failed to load. Instruction `Check the link's address before you open it.`, no meter, `We couldn't check whether this address imitates another site.`; the details state the checks' own verdict and score the same way as a Look-alike's
  - The stored verdict and score never change; history and batch rows, the live region, and share cards say the same word.
- instructions: Safe `Looks safe to open.` (or `Probably safe — still check who sent it.` when confidence is below high, a check failed or only partly finished, or there were minor warning signs), Suspicious `Don't sign in or enter payment details here.`, Malicious `Don't open this link.`, Critical `Don't open this link — it's a known threat.` when a reputation source confirmed it, Unknown `We couldn't check this link — treat it as unsafe.`, Error `The scan failed — try again.`
- meter: `Threat score` with `aria-valuenow` and `Safe band 0–24` style text beside it; absent for Unknown, Error, Look-alike, Unconfirmed, and every shared snapshot
- strip: toolbar `Checks`, eight numbered buttons named `<cell>: <finding>` in fixed order (VirusTotal, Link pattern, Safe Browsing, Threat feeds, Certificate, Registration, DNS, Redirects). In Summary a cell moves focus to the question citing it; in Full it opens and focuses its row. Arrow keys move between cells. A legend under it names only the states it draws.
- summary: list `Questions`, five `li[data-question]`, each an h4, a line naming the numbered checks its answer rests on (`From 1 VirusTotal · …` on screen; `Sources: …`, or `Source: …` for a single check, when read or copied), and the answer:
  - `reported`: `Has it been reported?`
  - `destination`: `Where would it take me?`
  - `concern`: `What else raises concern?`
  - `https`: `Does HTTPS make it safe?`
  - `other`: `What did the other checks find?`
- full: switch `Summary Full signal list` (`aria-checked="true"` on Full), list `Signals`, eight `li[data-signal]` rows labelled `<Label>: <finding>`; a row with evidence is a disclosure of label and value pairs
- error: an Error result keeps the eight rows on Summary (there is nothing to answer the questions with)
- details: `How we reached this verdict` (closed): `What we found`, `What to do`, `Caveats`, `Why <level> confidence`, then `<n>/8 checks · <ms> ms · finished <time>` (plus `· cached`), and `Reference: <scan id>` once for a failed or partial scan

## How to get to it (user POV)

Run a scan. The verdict word is the heading of region `Scan result: <word>`, with the site the link belongs to under it and what to do under that. Under the link taken apart, Evidence starts with the numbered strip; click a cell to jump to the answer that uses it. Summary is the default. Click the Summary / Full switch to see every check. Click a row that has a chevron to read the evidence pairs.

Fixture URLs, typed as a person would:

- `example.com` shows `Safe`, `Looks safe to open.`, and in `reported`: `Not on any list we checked.`
- `https://malicious.scrutinix.test/login` shows `Malicious`, `Don't open this link.`; `reported` says `7 of 70 VirusTotal engines flag it as malicious and 2 as suspicious.`; the Full row is `VirusTotal: 7 engines flagged this link as malicious, 2 as suspicious.`
- `https://feed-hit.scrutinix.test/payload.exe` shows `Malicious`; `reported` says `URLhaus lists this link as active malware distribution (listed 6 hours ago).`; the Full row is `Threat Feeds: URLhaus lists this link as active malware distribution.`
- `https://critical.scrutinix.test/login` shows `Critical`, `Don't open this link — it's a known threat.`, and a score of 80 or more
- `https://unreachable.scrutinix.test/` shows `Unknown`, `We couldn't check this link — treat it as unsafe.`, no meter, and `destination` says `We couldn't reach the site, so we can't say where it leads.`
- `https://error.scrutinix.test/` shows `Error`, `The scan failed — try again.`, eight rows `This check could not be completed.`, and a `Reference:` line in the details
- `https://long-hop.scrutinix.test/` shows `Safe` and, in `destination`, `It ends on accountverificationandsecuritycheckpointforyoursigninportalnowx.com, a different site` (one redirect to a 63-letter name). The question wraps inside a 390px-wide page; the page does not scroll sideways
- `https://paypal.com.secure-login.xyz/verify` shows `Look-alike` with `secure-login.xyz` under it (a login part spelling out a site, `https://paypal.com@secure-login.xyz/`, is a look-alike too, captioned `Ignored by browsers`)
- any safe link while the parser chunk fails shows `Unconfirmed`

## Driving it with Playwright

`npm run verify:drive` tests `single scan share and rescan`, `verdicts and history`, `link taken apart on paste, then a look-alike`, `error and critical verdicts`, `an address check that fails to load reads Unconfirmed`, and `a long destination host stays on the page`.

```ts
await scanSingle(page, "https://malicious.scrutinix.test/login", "malicious");
const strip = page.getByRole("toolbar", { name: "Checks" });
await strip.getByRole("button", { name: /^DNS:/ }).click();
await expect(
  page.getByRole("heading", { name: "What did the other checks find?" }),
).toBeFocused();
await page.getByRole("switch", { name: "Summary Full signal list" }).click();
const rows = page.getByRole("list", { name: "Signals" });
await rows.getByLabel(/^TLS Certificate:/).click();
await expect(page.getByText("Fixture CA")).toBeVisible();
```

`Fixture CA` is fixture TLS data rendered in the disclosure. That string is the side effect that the signal payload reached the screen.

`Unconfirmed` is driven by failing the parser's chunk, a real network failure: route `**/_next/static/chunks/**/*.js`, fetch each, and abort the one whose body contains `getPublicSuffix`.

Screenshots: `verdict-malicious.png`, `verdict-unknown.png`, `verdict-feed.png`, `verdict-critical.png`, `verdict-error.png`, `verdict-look-alike.png`, `verdict-unconfirmed.png`, `verdict-long-hop.png`, `single-safe.png`.

## Gotchas

- Match the region by the word shown, case-insensitively: `Scan result: Look-alike` for a Safe look-alike, never `Scan result: safe`.
- Row names are `<Label>: <finding>` (`VirusTotal: No engines flagged this link.`), not `… signal: …`. Match with a prefix such as `/^DNS Profile:/`. Strip cells use the short names (`DNS:`, `Registration:`, `Threat feeds:`).
- Summary has no per-check rows, so a row label is only on the page after the switch is on (except on an Error result). The view mode lasts for the page, so a later scan in the same test stays on Full.
- The band's `because` sentence shows only when no question or row already states it. Do not require it.
- `unknown` must not present a `Scan result: safe` region. Absence of findings is not a safe verdict.
- There is no `suspicious` fixture hostname. Do not invent one.
- `How we reached this verdict` opens the reasons and the check line; after a re-scan of a complete result it ends with `· cached`. That is the share-and-rescan check. Failed or partial results are never cached, so a re-scan of `error.scrutinix.test` runs every check again.
- A source that found nothing is `clear` (a gray dash), never green. Each strip state has its own shape. Do not assert colours.
- The Look-alike details still say `Why high confidence`: confidence covers the reputation checks, and the list says the address still imitates the other site.
