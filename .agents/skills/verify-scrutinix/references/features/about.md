# About

How a scan becomes a verdict. This is the method page. It is not a second scanner.

## Sub-features

- scoring: which signals move risk, and which only support it
- score-bands: Safe, Suspicious, Malicious, Critical
- confidence: coverage-aware confidence, stated next to partial results
- using-the-scanner: signal rows, batch rows, history, feed match rules

## How to get to it (user POV)

From any page, open About in the header or the footer. The heading is `How a scan becomes a verdict.` The current nav link has `aria-current="page"`. A link in the body goes back to `/#scan-console`. Another goes to Privacy.

## Driving it with Playwright

`npm run verify:drive` test `about and privacy`.

```ts
await page
  .getByRole("navigation", { name: "Primary" })
  .getByRole("link", { name: "About" })
  .click();
await expect(
  page.getByRole("heading", { name: "How a scan becomes a verdict." }),
).toBeVisible();
await expect(page.getByRole("heading", { name: "Score bands" })).toBeVisible();
```

Screenshot: `about.png`.

## Gotchas

- The page is static. There is no scan here, and no IndexedDB write.
- Score band labels are visible text (`Safe`, `Suspicious`, `Malicious`, `Critical`). They are not a live verdict.
- Do not treat this page as proof that a scan scored inside a band. That proof is a verdict region on `/`.
