# Sharing to Scrutinix

Links that arrive from outside the page. Every way in (the Android share target, the iOS Shortcut, the bookmarklet, any `/?url=<link>` link) does the same thing: it fills in the Single field, shows the link taken apart, focuses Analyze, and waits. Nothing scans until the person taps Analyze (or presses Enter).

## Sub-features

- prefill: `/?url=<encoded link>` fills `URL to analyze` with the link as the server normalized it (scheme and host case, default port, and fragment dropped: `HTTPS://Malicious.Scrutinix.Test:443/login#top` becomes `https://malicious.scrutinix.test/login`)
- focus: Analyze takes focus, not the field, so a phone keyboard never covers the breakdown below it. That focus holds in Chromium (and Playwright's three engines); in Safari, VoiceOver's own reading of a new page moves focus away from Analyze, so a screen-reader user can't rely on it.
- arrival: the page's status region (`p[role='status']`) says once, after the link parser settles: `Link filled in: <host>. Press Analyze to check it.`, with the owner sentence before `Press Analyze` when the link spells out another site (`Link filled in: paypal.com.secure-login.xyz. This link belongs to secure-login.xyz, not paypal.com. Press Analyze to check it.`). It clears a few seconds later. Focus doesn't move to the field for it. TalkBack spoke it on every arrival; VoiceOver in Safari spoke it only when it landed before VoiceOver began reading the new page, and its page read then talked over it. So the same words are also in reading order: an `sr-only` line in `Scan console`, before the tabs (`Link filled in: <host>. Press Analyze to check it.`), from the first paint while Single is chosen, until the link is edited or its scan or result is on screen. A reader walking down the page meets it, then the tabs, the field, and the link taken apart with its owner sentence. It sits outside the tab panel because TalkBack reads a focusable panel's text with the panel's name, which said it twice.
- no-scan: no request to `/api/analyze` until the tap, then exactly one; the address then drops `url`
- refuse-silently: a value that can't be checked (`javascript:alert(1)`, `http://localhost/`, garbage) fills in nothing and shows no error
- share-target: `public/site.webmanifest` declares `share_target` (`POST /share`, form-encoded `title`, `text`, `url`). `/share` takes the first web link (the `url` field whole, else a link found in `text`, then `title`), sets no cookie, logs nothing, and answers `303` to `/?url=<link>`. With no link, when the first link can't be checked (it never falls back to a later one), or when the body is over 16 KiB, it answers `303` to `/?nolink=1`. A form another site posts gets the same redirect and still only fills in.
- no-link note: `/?nolink=1` draws one line under the form, `We didn't find a link to check in what you shared.` (muted, not an alert; the visible line is `aria-hidden`), and puts the same sentence in a `status` region about half a second after load, so screen readers hear it once, politely. The field stays empty, focus stays where the page put it (not Analyze), and nothing scans. The line goes for good once the person types or pastes (in Single or Batch), scans, or taps Analyze on an empty field (the form's own "Paste a link to check." then stands alone); `nolink` leaves the address when a result lands, so a reload before then shows the line again. A resolving `?shared=` or `?url=` outranks it; a plain `/` never shows it.
- get-share: `GET /share` (opened by hand) answers `303` to `/`, with no note
- precedence: a `?shared=` result outranks `?url=`; nothing is filled in (see `share-and-rescan.md`)

## How to get to it (user POV)

On Android with Scrutinix installed, share a link (or a message containing one) to Scrutinix. On iPhone, the README's Shortcut opens `/?url=`. On a desktop, the README's bookmarklet opens `/?url=` with the current page. Scrutinix opens with the link in the field, taken apart below it, and Analyze highlighted. Tap Analyze to check it. Share a message with no link in it and Scrutinix opens with an empty field and one quiet line saying it didn't find a link to check.

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
await expect(page.locator("p[role='status']")).toHaveText(
  "Link filled in: malicious.scrutinix.test. Press Analyze to check it.",
);
await page.waitForTimeout(1_000);
expect(scans).toEqual([]);
```

The share sheet's request is a POST navigation the browser builds itself. `launchFromShareSheet(page, fields)` in `scripts/support.ts` turns the test's own navigation to `/share` into that POST (form-encoded), the way `tests/e2e/sharing.smoke.spec.ts` does, and returns the request `/share` received. The drive shares `Your parcel is waiting: <link>` in `text` with an empty `url`, then expects a POST, an address whose only parameter is `url`, no cookies, the field filled, Analyze focused, and no scan. One tap on Analyze then shows `Scan result: malicious`, drops `url` from the address, and makes exactly one scan request (checked again after a one-second quiet window). Then it shares `Call me when you get home.` (title `Dinner plans`, no `url`) and expects an address of exactly `?nolink=1`, an empty field, the line `We didn't find a link to check in what you shared.` under the form, a `status` region holding the same sentence, no alert, and no scan; typing in the field removes both. Last, `page.request.get("/share", { maxRedirects: 0 })` is `303` to `/`.

Screenshots: `share-target-prefilled.png`, `share-target-no-link.png`.

## Gotchas

- Proving "no scan" needs a window to watch. The drive waits one second (`QUIET_WINDOW_MS`) after the page settles; that is the one fixed wait in the sweep.
- Real share-sheet launches (an installed app on Android) are `INCONCLUSIVE` in this loop. The routed POST reaches the same route handler with the same fields; Chromium stamps it `Sec-Fetch-Site: none` as it does a real launch, which Playwright does not report for a routed request.
- On Back to a page a link arrived on, the router restores the server render: the field is filled again and still nothing scans. `tests/e2e/sharing.smoke.spec.ts` covers that and a link over 4 KiB once encoded; `tests/integration/share-route.test.ts` covers the 16 KiB body limit.
- The no-link note's visible line and its `status` twin hold the same text, so `getByText` matches two nodes: find the line with `p[aria-hidden='true']` and the announcement with `getByRole("status")`. Whether a real screen reader speaks it on arrival (TalkBack after the share sheet, VoiceOver during Safari's page-load read) is `INCONCLUSIVE` in this loop.
- The site never asks anyone to install it; the browser's own install UI is the only prompt.
- "Analyze is focused" is what Chromium (and the drive) shows. Real VoiceOver in Safari starts reading the page on load and takes focus with it; the status-region message is what tells a VoiceOver or TalkBack user a link arrived. Real screen readers are `INCONCLUSIVE` in this loop.
- `/share` has no rate-limit tier of its own; the scan a person then starts is metered by the scan tier.
