# About

`How a scan becomes a verdict.` The open methodology: every weight, threshold, and rule the verdict engine uses, printed from `lib/domain/methodology.ts` (which `tests/unit/methodology.test.ts` runs through the engine). It is not a second scanner.

## Sub-features

- scoring: what moves the verdict (Safe Browsing, the threat feeds, VirusTotal, the link pattern model), what only supports it (certificate, domain age and registrar, DNS, redirects), and how points add up to a 0 to 100 score
- score-bands: `0–24` Safe, `25–54` Suspicious, `55–79` Malicious, `80–100` Critical; Unknown and Error show no score
- points: section `Points for each finding`, three tables captioned `Lists of known bad links`, `Checks of the link itself`, and `What lowers the score`, each with columns `Finding` and `Points` and notes under it. One note under `Checks of the link itself` states how the link pattern model reads a link and what its bar flagged: only the site and path ("not what follows a ? or #"), with and without https:// and www., random-looking IDs left out; about 1 in 100 popular sites, pages inside them, and sign-in pages, 3 in 100 official short links, 16 in 100 account and email links (account confirmation pages, email verification and click-tracking links), and about 36 in 100 links from a public phishing list (figures from `PATTERN_MODEL_EVALUATION` in `lib/domain/methodology.ts`, measured offline per `lib/server/ml/model/README.md`). The rows `The link pattern model calls it malicious` / `... risky` price points as 45 × / 16 × "the score the model and the structure checks give together"
- rules: section `The rules`, a definition list of the engine's rules
- confidence: High and Moderate thresholds, the limits on confidence, and the disclosure `How the figure adds up` (a table with columns `For` and `Percentage points`)
- cells: `Reading the eight cells`, the strip's order, when the threat feeds' cell reads `Flagged the link` (a convicting or high-confidence listing) rather than `Found a warning sign` (other links on the site, or a weaker listing), the certificate's `Didn't apply` for a plain-HTTP link that never reaches HTTPS and whose site offers no HTTPS a browser would use instead, and a legend of each state's shape
- ownership: `Which site a link belongs to`, the registered domain explained with `paypal.com.secure-login.xyz`
- using-the-scanner: Summary's five questions, Full's eight rows, Batch, and history, with links to `/#scan-console` and `/privacy`
- name: `The name`, with the pronunciation `Scrutinix (SCROO-tih-nix)`

## How to get to it (user POV)

From any page, open About in the header or the footer. The heading is `How a scan becomes a verdict.` The current nav link has `aria-current="page"`. On a result, the band's `How scoring works` link opens `/about#scoring`. Sections have anchors: `#scoring`, `#points`, `#rules`, `#confidence`, `#name`.

## Driving it with Playwright

`npm run verify:drive` test `about and privacy`, plus the band link in `error and critical verdicts`.

```ts
await page
  .getByRole("navigation", { name: "Primary" })
  .getByRole("link", { name: "About" })
  .click();
await expect(
  page.getByRole("heading", {
    level: 1,
    name: "How a scan becomes a verdict.",
  }),
).toBeVisible();
await expect(
  page.getByRole("table", { name: "Lists of known bad links" }),
).toBeVisible();
await page.getByText("How the figure adds up", { exact: true }).click();
await expect(
  page.getByRole("columnheader", { name: "Percentage points" }),
).toBeVisible();
```

The drive checks all nine section headings, the three scoring tables by caption, the bands (`Safe`, `80–100`), the confidence disclosure opening, and `SCROO-tih-nix`.

Screenshot: `about.png`.

## Gotchas

- The page is static. There is no scan here, and no IndexedDB write.
- Score band labels are visible text (`Safe`, `Suspicious`, `Malicious`, `Critical`). They are not a live verdict. Do not treat this page as proof that a scan scored inside a band; that proof is a verdict region on `/`.
- The table rows are generated from the engine's constants. Do not hard-code a point value in a drive: the methodology unit test already ties every printed number to the engine, and a weight change would break the drive for no product reason.
- `Confidence` and `Scoring` are both section headings and words in body text. Match headings by role with `exact: true`.
- The confidence table is inside a closed `details`; it is hidden until `How the figure adds up` is opened.
