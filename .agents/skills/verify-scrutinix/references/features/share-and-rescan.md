# Share and re-scan

Copy a signed link to the current verdict, open it as a recipient, then run the same URL again.

## Sub-features

- share: button `Share` copies a URL with `shared` (the payload) and `sig` (the server's signature); toast `Link copied to clipboard` with `It shows this result for 3 days after the check.`
- verified: a signed link opens recipient-first, without a new scan: region `Scan result: <word>` (word, registered domain, instruction, the payload's summary; a snapshot carries no score, so there is no meter; the instruction is the one the sender's band showed, worded from the signed `basis`: a shared high-confidence Safe reads `Looks safe to open.`, a confirmed Critical `Don't open this link — it's a known threat.`; a link signed before the basis existed keeps the hedged forms `Probably safe — still check who sent it.` and a plain `Don't open this link.`), `Verified Scrutinix result · checked <UTC time>. It may be out of date.`, button `Run a fresh scan`, the link taken apart, list `Checks` (the eight cells), then heading `Check another link` over an empty form. The page title and `og:image` (`/og/result?shared=…&sig=…`) preview that result.
- unverified: the same payload without a valid `sig`, or edited by one character, opens region `Shared link, not verified`: heading `Check this shared link yourself`, `We can't confirm the result in this link came from Scrutinix. It may be old or edited, so we're not showing it.`, button `Scan this link`, and Scrutinix's own breakdown of the link. No verdict word, tint, score, summary, or strip, and the site's default title and image.
- expired: a signed result more than 3 days after its check opens region `Shared result, expired` with `This shared result is more than 3 days old, so we're not showing it.`, otherwise the same as unverified. A signed check time more than 5 minutes in the future opens as `Shared link, not verified`, not expired.
- precedence: a shared result outranks a `?url=` beside it; nothing is filled in
- rescan: button `Re-scan` on a finished result, `Run a fresh scan` on a verified share, `Scan this link` on the neutral band. A scan from a shared link drops `shared` and `sig` from the address, and the result stays where the shared one was.
- cache: a repeat of the same URL within 15 minutes is marked `· cached`
- sender-side toasts: a result with no signature copies with `Link copied, but it isn't verified`; a history entry past its 3 days copies with `Link copied, but this result has expired`. Both offer `Scan again` when a fresh scan would get a current signature.

## How to get to it (user POV)

After a verdict, click Share. The toast says the link was copied and that it shows this result for 3 days. Paste it in a new tab. The page leads with the verified band, the link taken apart, and the eight cells, then `Check another link` and an empty form. Anyone can write a `?shared=` payload, so a link without Scrutinix's signature (or with an edited payload) opens a neutral band instead: `Check this shared link yourself` and `Scan this link`. On a live result, `Re-scan` runs the URL again. A cached repeat says so under `How we reached this verdict`.

## Driving it with Playwright

`npm run verify:drive` test `single scan share and rescan`.

1. Scan `example.com` until `Scan result: safe`.
2. Click `Re-scan`.
3. Expect a second request to `/api/analyze` (`recordScans`), then open `How we reached this verdict` and expect `· cached`. The request count is the proof the re-scan ran: an earlier smoke run may already have cached `example.com`.
4. IndexedDB `scans` holds `https://example.com/` once. History keeps one row per link, so the re-scan replaces the first entry. The heading reads `History (1 scan)`.
5. Click `Share`. Expect `Link copied to clipboard` and the 3-day line. Read `navigator.clipboard.readText()`. Expect a `shared` parameter and a 43-character base64url `sig`.
6. `page.goto` that URL. Expect region `Scan result: safe` with `Verified Scrutinix result · checked`, `Looks safe to open.` (what the sender's band said), and `Run a fresh scan`, list `Checks` with eight items, heading `Check another link`, exactly one `h1` (the home headline is not drawn), an empty `URL to analyze` that is not focused, and an `og:image` under `/og/result?shared=` that answers 200 `image/png`.
7. `page.goto` the same link plus `&url=https://example.org/`. The field stays empty.
8. `page.goto` the same `shared` value without `sig`. Expect region `Shared link, not verified`, heading `Check this shared link yourself`, button `Scan this link`, heading `The link, taken apart`, and no `Scan result` region, meter, list `Checks`, `Verified Scrutinix result`, or `/og/result` image.

Screenshots: `single-rescan.png`, `single-shared-verified.png`, `single-shared-unsigned.png`.

Signing needs a key. `verify:launch` starts `next dev` with `SCRUTINIX_TEST_FIXTURES=1` and the published e2e key, exactly as `scripts/run-e2e.mjs` does. `lib/config/env.ts` accepts only that key in fixture mode, and refuses it outside fixture mode, so this loop never uses or needs a real key. Do not set `SHARE_SIGNING_SECRET` yourself for this loop.

The drive does not also click `Run a fresh scan` or `Scan this link`. Both call the same rescan path and would spend another analyze request. One re-scan plus the share navigations is the proof. `tests/e2e/sharing.smoke.spec.ts` covers the fresh scan clearing `shared` and `sig` from the address.

Grant `clipboard-read` and `clipboard-write` on the context. `verify:drive` does this.

## Gotchas

- A toast that says the link was copied is not the proof. The verified band on the copied URL, and the neutral band on the unsigned one, are the proof.
- A verified share expires 72 hours after it was captured. The drive opens the link immediately. To see `Shared result, expired` you need a payload signed with the e2e key and an old `capturedAt`; `tests/e2e/app.smoke.spec.ts` builds one, the drive does not.
- Editing any character of a signed payload makes it unverified. A payload that does not decode at all (`?shared=not-a-snapshot`), or whose link could not be scanned, is no shared link: it renders the plain scanner. That case lives in input validation.
- The check time on a verified band is the original scan's check time, kept on a cache hit, shown in UTC.
- Share does not write the server. There is no share database to query.
- The result cache is process memory on the dev server. Cleanup and a new launch forget it. A re-scan after a fresh launch is not cached.
- Clipboard permission is a browser context setting. A drive without it fails the read, which is a harness gap, not a product failure. Where the clipboard write fails, Share hands the link to the system share sheet if there is one, and otherwise shows `Couldn't copy the link — select it below and copy it yourself.` with a read-only textbox `Share link`.
- Fetching `og:image` spends one request of the image rate-limit tier, not the scan tier.
