# Batch scan

Analyze up to 10 URLs, then open one result in the single scanner.

## Sub-features

- input: one URL per line, Ctrl+Enter or Start batch
- progress: region `Batch scan results` reads `Checking links` while running, then `Batch results` with a finished count such as `2/2`
- export: CSV and JSON of the batch results
- open: a finished row's Open button switches to Single and shows that verdict

## How to get to it (user POV)

On `/`, choose the Batch tab. Paste URLs, one per line. The hint says up to 10 and Cmd/Ctrl+Enter. Click Start batch. When the list says `Batch results` and `2/2`, use `Export batch CSV` or `Export batch JSON`. Click Open on a row to read the full verdict.

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
await expect(results).toContainText("Batch results");
await expect(results).toContainText("2/2");
```

Side effects:

- IndexedDB contains `https://example.org/` and `https://example.net/`.
- The `Export batch CSV` download contains both hosts. Saved as `batch.csv` in the evidence directory.
- `Open result for example.org` selects the Single tab (`aria-selected="true"`), shows region `Scan result: safe`, and the link anatomy names `example.org`.

Screenshots: `batch-complete.png`, `batch-opened.png`.

Validation for an empty batch and an 11th URL is in `input-validation.md`.

## Gotchas

- The batch costs one rate-limit token per URL. Two URLs cost 2. Eleven URLs are rejected in the browser and cost nothing.
- The batch form's control is named `Export batch CSV`. The history control is named `Export history CSV`. Use the exact name.
- Each Open button is named `Open result for <host>` (plus `(look-alike link)` for a look-alike). Match the host.
- Both fixture hosts are `safe`. The proof that Open kept the right row is the host in the link anatomy, not the word safe alone.
- Cancel on a batch is `INCONCLUSIVE` in fixture mode for the same reason as a single scan: the rows finish before Cancel is a stable target.
