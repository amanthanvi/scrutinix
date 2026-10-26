# Batch scan

Analyze up to 10 URLs, then open one result in the single scanner. The Batch panel and its results table load with the tab, and a failed load retries in place.

## Sub-features

- lazy: the Batch input and its results table are loaded when the tab is first opened; while they arrive, an invisible stand-in with the input's geometry holds the panel's height, and region `Results` reads `Loading batch results…`
- retry: if that load fails, tabpanel `Batch` shows alert `Batch didn't load. Check your connection and try again.` and region `Results` (match it with `exact: true`) shows `Batch results didn't load. Check your connection and try again.`, each with button `Try again`; Single and any result on it keep working
- input: one URL per line, Cmd/Ctrl+Enter or Start batch; the hint counts `<n> of 10 entered.`
- progress: region `Batch scan results` reads `Checking links` while running (rows `Checking`, button `Cancel batch`), then `Batch results` with a finished count such as `2/2`, or `Batch stopped` with rows `Not checked` when it ended early; the live region says `Checking <n> links.` once (not each finished link; the visible count is the progress), then `Batch complete: <done> of <total> links scanned.` or `Batch stopped: …`
- export: `Export batch CSV` and `Export batch JSON` (toasts `Downloaded batch.csv`, `Downloaded batch.json`, each also said by the status region `p[role='status']`, with a full stop)
- open: a finished row's `Open result for <link>` switches to Single and shows that verdict
- rows: the mini strip, the verdict word (`Look-alike` for a Safe look-alike), and the link with its registered domain in bold

## How to get to it (user POV)

On `/`, choose the Batch tab. Its accessible name is `Batch`; the visible hint `up to 10 links` is its description, not part of that name. The tabs switch on Enter, Space, or a click, never on focus alone. Paste URLs, one per line. The hint says up to 10 and Cmd/Ctrl+Enter. Click Start batch. When the list says `Batch results` and `2/2`, use `Export batch CSV` or `Export batch JSON`. Click Open on a row to read the full verdict.

## Driving it with Playwright

`npm run verify:drive` tests `batch scan` and `a Batch panel that fails to load retries in place`.

```ts
await page.getByRole("tab", { name: "Batch" }).click();
const batch = page.getByRole("textbox", {
  name: "URLs to analyze, one per line",
});
await batch.fill("example.org\nhttps://example.net");
await page.getByRole("button", { name: "Start batch" }).click();
const results = page.getByRole("region", { name: "Batch scan results" });
await expect(results).toContainText("Batch results");
await expect(results).toContainText("2/2");
```

Side effects:

- IndexedDB contains `https://example.org/` and `https://example.net/`.
- The `Export batch CSV` download contains both hosts. Saved as `batch.csv` in the evidence directory.
- `Open result for example.org/` selects the Single tab (`aria-selected="true"`) and shows region `Scan result: safe` with `example.org` under the verdict word.

The retry test waits for `networkidle`, then aborts every `**/_next/static/chunks/**/*.js` request, opens Batch, expects both alerts and no `This part of the page stopped working.`, switches to Single (its field is still editable), removes the route, and clicks each `Try again`: the textarea appears and the results alert goes.

Screenshots: `batch-complete.png`, `batch-opened.png`, `batch-load-failed.png`.

Validation for an empty batch and an 11th URL is in `input-validation.md`.

## Gotchas

- The batch costs one rate-limit token per URL. Two URLs cost 2. Eleven URLs are rejected in the browser and cost nothing.
- The batch form's control is named `Export batch CSV`. The history control is named `Export history CSV`. Use the exact name.
- Each Open button is named `Open result for <link>`, the normalized link without its scheme: `example.org` becomes `Open result for example.org/`, `https://example.com/p0` becomes `Open result for example.com/p0`, plus ` (look-alike link)` for a look-alike. A link whose path runs past 48 characters is shortened as history rows speak it (`…, and <n> more characters`, see `history.md`). The drive matches it with `exact: true`; a bare substring like `example.org` also matches `example.org/path`.
- Both fixture hosts are `safe`. The proof that Open kept the right row is the host on the band, not the word safe alone.
- Open the tab only after `networkidle` when you mean to fail its chunk: a route added earlier also fails the page's own chunks.
- The tab's visible hint `up to 10 links` is its description, not its name: match `getByRole("tab", { name: "Batch" })`. Moving focus to it with the arrows does not open it; press Enter or Space, or click.
- The field is named by `aria-label` only (no hidden `<label>`, which was a reading stop of its own), and its hint paragraph is `aria-hidden`: it is the field's description, so a reading cursor meets it once.
- Known speech quirks left as they are (round one): Safari's VoiceOver reads the tab as `Batch up to 10 links` (WebKit counts the `aria-hidden` hint in a name taken from the tab's text; an `aria-label="Batch"` would hide visible text from the name, which axe's `label-content-name-mismatch` flags and voice control needs). TalkBack 16.2 with Chrome 124 reads the description before the name (`up to 10 links, Batch, tab`), and on the home page said `Single` twice on the Single tab (`selected, Single, tab, Single`), which shared pages didn't; the cause is not established.
- Cancel on a batch is `INCONCLUSIVE` in fixture mode for the same reason as a single scan: the rows finish before Cancel is a stable target.
