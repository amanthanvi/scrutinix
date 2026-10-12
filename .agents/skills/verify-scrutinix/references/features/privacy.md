# Privacy

What stays on the device, what the server processes, and what a shared link contains.

## Sub-features

- local-history: completed scans live in IndexedDB, with undo in the same session
- server-processing: submitted URLs are processed to produce the stream
- logging: operational logs keep hashes and timings, not the raw URL
- shared-links: the snapshot is embedded in the URL

## How to get to it (user POV)

Open Privacy in the header or the footer. The heading is `History stays in the browser.` Sections: `What stays local`, `What the server does`, `Logging`, `Shared links`.

## Driving it with Playwright

`npm run verify:drive` test `about and privacy`.

```ts
await page
  .getByRole("navigation", { name: "Primary" })
  .getByRole("link", { name: "Privacy" })
  .click();
await expect(
  page.getByRole("heading", { name: "History stays in the browser." }),
).toBeVisible();
await expect(page.getByRole("heading", { name: "Shared links" })).toBeVisible();
```

The header Privacy link has `aria-current="page"`.

Screenshot: `privacy.png`.

## Gotchas

- The page describes behavior. It does not store a scan. Prove storage from the history feature, and prove the share payload from the share feature.
- There is no account, cookie banner, or server-side history viewer on this page.
