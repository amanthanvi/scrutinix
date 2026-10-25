# Privacy

What stays on the device, what the server and outside services process, and how shared links and links shared to Scrutinix work.

## Sub-features

- local-history: finished scans live in this browser only, one entry per link, with undo right after a clear
- server-processing: which outside services receive the link, its hostname, its domain, or only its IP address, and that the server visits the link itself
- one-time-links: checking a link visits it, which can use up a password-reset or sign-in link
- caching: complete results are kept for 15 minutes; failed or stopped scans are not
- logging: logs keep timings and a fingerprint of the link, never the link; the host's request logs can see links carried in a page address (`?url=`, a shared result)
- rate-limits: counted by IP address
- shared-links: the result travels inside the link, signed by the server, shown for 3 days
- sharing-to-scrutinix: the share target keeps only the first web link and scans nothing until Analyze

## How to get to it (user POV)

Open Privacy in the header or the footer. The page has one `h1` inside `main#main-content`, then one `h2` section per topic. The h1 and the section text are product copy and change with disclosure edits, so checks anchor on structure and on two section titles: `Shared links` and `Sharing to Scrutinix`.

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
await expect(
  page.getByRole("heading", { name: "Sharing to Scrutinix" }),
).toBeVisible();
```

The header Privacy link has `aria-current="page"`.

Screenshot: `privacy.png`.

## Gotchas

- The page describes behavior. It does not store a scan. Prove storage from the history feature, the share payload from the share feature, and "nothing scans on arrival" from `sharing-to-scrutinix.md`.
- Doctor anchors only on structure (`main#main-content`, an `h1`, the header Privacy link with `aria-current="page"`), never on copy, so a disclosure rewrite cannot make doctor `NOT_READY`. The drive also checks the two section titles above; if a rewrite renames one, update the drive with it.
- There is no account, cookie banner, or server-side history viewer on this page, and the site never mentions installing it (the browser's own install UI is the only prompt).
