# Batch scan

Analyze up to 10 URLs, then open one result in the single scanner.

## Sub-features

- input: one URL per line, Ctrl+Enter or Start batch
- progress: region `Batch scan results` counts finished rows
- export: CSV and JSON of the batch results
- open: a finished row's Open button switches to Single and shows that verdict

## How to get to it (user POV)

On `/`, choose the Batch tab. Paste URLs, one per line. The hint says up to 10 and Cmd/Ctrl+Enter. Click Start batch. When the list says `Batch complete` and `2/2`, Export CSV or Export JSON. Click Open on a row to read the full verdict.

## Driving it with Playwright

`npm run verify:drive` test `batch scan`.

```ts
await page.getByRole("tab", { name: "Batch" }).click();
const batch = page.getByRole("textbox", {
  name: "URLs to analyze, one per line",
});
await batch.fill("example.org\nhttps://example.net");
await page.getByRole("button", { name: "Start batch" }).click();
const results = page.getByRole("region", { name: "Batch scan results" });
await expect(results).toContainText("Batch complete");
await expect(results).toContainText("2/2");
```

Side effects:

- IndexedDB contains `https://example.org/` and `https://example.net/`.
- The Export CSV download contains both hosts. Saved as `batch.csv` in the evidence directory.
- Open on the first row selects the Single tab (`aria-selected="true"`) and region `Scan result: safe` contains `example.org`.

Screenshots: `batch-complete.png`, `batch-opened.png`.

Validation for an empty batch and an 11th URL is in `input-validation.md`.

## Gotchas

- The batch costs one rate-limit token per URL. Two URLs cost 2. Eleven URLs are rejected in the browser and cost nothing.
- Export CSV on the batch form is named `Export CSV`. The history control is named `Export history as CSV`. Use the exact name.
- Open is a row button. When two rows are finished, click `.first()` or match the URL's row.
- Both fixture hosts are `safe`. The proof that Open kept the right row is the URL text inside the verdict region, not the word safe alone.
- Cancel on a batch is `INCONCLUSIVE` in fixture mode for the same reason as a single scan: the rows finish before Cancel is a stable target.
