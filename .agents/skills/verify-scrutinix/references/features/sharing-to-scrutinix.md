# Sharing to Scrutinix

Links that arrive from outside the page. Every way in (the Android share target, the iOS Shortcut, the bookmarklet, any `/?url=<link>` link) does the same thing: it fills in the Single field, shows the link taken apart, focuses Analyze, and waits. Nothing scans until the person taps Analyze (or presses Enter).

## Sub-features

- prefill: `/?url=<encoded link>` fills `URL to analyze` with the link as the server normalized it (scheme and host case, default port, and fragment dropped: `HTTPS://Malicious.Scrutinix.Test:443/login#top` becomes `https://malicious.scrutinix.test/login`)
- focus: Analyze holds focus, not the field, so a phone keyboard never covers the breakdown below it
- no-scan: no request to `/api/analyze` until the tap, then exactly one; the address then drops `url`
- refuse-silently: a value that can't be checked (`javascript:alert(1)`, `http://localhost/`, garbage) fills in nothing and shows no error
- share-target: `public/site.webmanifest` declares `share_target` (`POST /share`, form-encoded `title`, `text`, `url`). `/share` takes the first web link (the `url` field whole, else a link found in `text`, then `title`), sets no cookie, logs nothing, and answers `303` to `/?url=<link>`. With no link, or when the first link can't be checked (it never falls back to a later one), it answers `303` to `/`. A form another site posts gets the same redirect and still only fills in.
- get-share: `GET /share` (opened by hand) answers `303` to `/`
- precedence: a `?shared=` result outranks `?url=`; nothing is filled in (see `share-and-rescan.md`)

## How to get to it (user POV)

On Android with Scrutinix installed, share a link (or a message containing one) to Scrutinix. On iPhone, the README's Shortcut opens `/?url=`. On a desktop, the README's bookmarklet opens `/?url=` with the current page. Scrutinix opens with the link in the field, taken apart below it, and Analyze highlighted. Tap Analyze to check it.

## Driving it with Playwright

`npm run verify:drive` test `sharing to Scrutinix fills in the link and waits for Analyze`.

```ts
await isolateRateLimit(page);
const scans = recordScans(page);
await page.goto(
  `/?url=${encodeURIComponent("HTTPS://Malicious.Scrutinix.Test:443/login#top")}`,
);
await waitForHydration(page);
const input = page.getByRole("textbox", { name: "URL to analyze" });
await expect(input).toHaveValue("https://malicious.scrutinix.test/login");
await expect(page.getByRole("button", { name: "Analyze URL" })).toBeFocused();
await expect(
  page.getByRole("region", { name: "The link, taken apart" }),
).toContainText("scrutinix.test");
await page.waitForTimeout(1_000);
expect(scans).toEqual([]);
```

The share sheet's request is a POST navigation the browser builds itself. `launchFromShareSheet(page, fields)` in `scripts/support.ts` turns the test's own navigation to `/share` into that POST (form-encoded), the way `tests/e2e/sharing.smoke.spec.ts` does, and returns the request `/share` received. The drive shares `Your parcel is waiting: <link>` in `text` with an empty `url`, then expects a POST, an address whose only parameter is `url`, no cookies, the field filled, Analyze focused, and no scan. One tap on Analyze then shows `Scan result: malicious`, drops `url` from the address, and makes exactly one scan request (checked again after a one-second quiet window). Last, `page.request.get("/share", { maxRedirects: 0 })` is `303` to `/`.

Screenshot: `share-target-prefilled.png`.

## Gotchas

- Proving "no scan" needs a window to watch. The drive waits one second (`QUIET_WINDOW_MS`) after the page settles; that is the one fixed wait in the sweep.
- Real share-sheet launches (an installed app on Android) are `INCONCLUSIVE` in this loop. The routed POST reaches the same route handler with the same fields; Chromium stamps it `Sec-Fetch-Site: none` as it does a real launch, which Playwright does not report for a routed request.
- On Back to a page a link arrived on, the router restores the server render: the field is filled again and still nothing scans. `tests/e2e/sharing.smoke.spec.ts` covers that and a link over 4 KiB once encoded; `tests/integration/share-route.test.ts` covers the 16 KiB body limit.
- The site never asks anyone to install it; the browser's own install UI is the only prompt.
- `/share` has no rate-limit tier of its own; the scan a person then starts is metered by the scan tier.
