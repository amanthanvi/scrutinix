# Privacy

What stays on the device, what the server processes, and what a shared link contains.

## Sub-features

- local-history: completed scans live in IndexedDB, with undo in the same session
- server-processing: submitted URLs are processed to produce the stream
- logging: operational logs keep hashes and timings, not the raw URL
- shared-links: the snapshot is embedded in the URL

## How to get to it (user POV)

Open Privacy in the header or the footer. The page has one `h1` inside `main#main-content`, then `h2` sections. The heading and section copy are product copy and change with disclosure edits (for example `History stays in the browser.` on main, `What leaves this browser.` in scrutinix #61), so do not anchor checks on them. `Shared links` is the one section title present in both versions.

## Driving it with Playwright

`npm run verify:drive` test `about and privacy`.

```ts
await page
  .getByRole("navigation", { name: "Primary" })
  .getByRole("link", { name: "Privacy" })
  .click();
await expect(page).toHaveURL(/\/privacy$/);
await expect(
  page.locator("main#main-content").getByRole("heading", { level: 1 }),
).toBeVisible();
await expect(page.getByRole("heading", { name: "Shared links" })).toBeVisible();
```

The header Privacy link has `aria-current="page"`.

Screenshot: `privacy.png`.

## Gotchas

- The page describes behavior. It does not store a scan. Prove storage from the history feature, and prove the share payload from the share feature.
- Doctor and drive anchor on structure (`main#main-content`, an `h1`, the header Privacy link with `aria-current="page"`), not the heading text.
- There is no account, cookie banner, or server-side history viewer on this page.
