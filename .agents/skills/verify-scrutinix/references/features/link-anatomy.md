# The link, taken apart

The link in the field is taken apart in the browser as soon as it is a checkable web link, before any scan: which site it really belongs to, each part named, and a look-alike stated plainly. An optional `Expecting a particular site?` compares it with the site the person expected. Once that link's scan or result is on screen, the result's own breakdown takes over.

## Sub-features

- on-paste: region `The link, taken apart` under the field, with captions (`A label anyone can add`, `Registered domain` in bold, `A page on that domain`); no request to `/api/analyze`. A screen reader hears each part as one string after its name (`Registered domain: secure-login.xyz`); the drawn parts and captions are `aria-hidden`, and the line has no `title` (Chrome on Android read a title as the line's whole text, so TalkBack never spoke the part names). A long path may break after the slashes that follow a name (`<wbr>`) before it wraps anywhere.
- look-alike: when the rest of the link spells out another site, `This link belongs to <owner>, not <site>.` (for `https://paypal.com.secure-login.xyz/verify`: `secure-login.xyz`, not `paypal.com`), in `p.sx-owner`. It is drawn with its domains in mono, each kept whole, and spoken as one string (an `sr-only` copy; the drawn one is `aria-hidden`): its inline-block domains were four reading stops in TalkBack and VoiceOver. A login part does too (`https://paypal.com@secure-login.xyz/`), captioned `Ignored by browsers`.
- expected-site: button `Expecting a particular site?` opens textbox `Which site were you expecting?` (focused). The answer shows as you type (it is the field's description) and is spoken once typing pauses for 700 ms, by the page's status region (`p[role='status']`), not on every keystroke:
  - a matching domain or link: `Matches <owner>.`
  - the site a look-alike spells out: `No. The link only spells out <site>.`; another domain on a look-alike: `No. This link doesn't belong to <domain>.`; another domain otherwise: `This link belongs to <owner>, not <domain>.`
  - a name, not an address: `We can't tell from a name whether <owner> is <name>'s site. Type its address to compare.`
- hand-over: Analyze removes the region; the result shows the same breakdown under the heading `The link, taken apart`, and the band names the registered domain under the verdict word
- arriving links: a `/?url=` link or a share to Scrutinix shows the same breakdown (see `sharing-to-scrutinix.md`)

## How to get to it (user POV)

On `/`, paste or type a link into `URL to analyze`. The breakdown appears under the field without pressing anything. Click `Expecting a particular site?` and type what you expected (`paypal.com`, or `PayPal`). Press Analyze: the result replaces the breakdown with its own.

## Driving it with Playwright

`npm run verify:drive` test `link taken apart on paste, then a look-alike`; `verify:smoke` checks the breakdown for `example.com`.

```ts
const scans = recordScans(page);
await gotoApp(page);
await fillSingle(page, "https://paypal.com.secure-login.xyz/verify");
const pasted = page.getByRole("region", { name: "The link, taken apart" });
await expect(pasted).toContainText("Registered domain");
await expect(pasted).toContainText(
  "This link belongs to secure-login.xyz, not paypal.com.",
);
await pasted
  .getByRole("button", { name: "Expecting a particular site?" })
  .click();
const expected = page.getByRole("textbox", {
  name: "Which site were you expecting?",
});
await expected.fill("paypal.com");
await expect(pasted).toContainText("No. The link only spells out paypal.com.");
await expect(page.locator("p[role='status']")).toHaveText(
  "No. The link only spells out paypal.com.",
);
expect(scans).toEqual([]);
```

The drive checks the owner sentence appears once beside the `paypal.com` answer, then types `secure-login.xyz` (`Matches secure-login.xyz.`) and `PayPal` (the name answer), confirms no scan request yet, clicks Analyze, and expects region `Scan result: Look-alike`, the pasted region gone, and exactly one scan request after a one-second quiet window. The look-alike band is in `verdict-and-signals.md`.

Screenshots: `anatomy-paste.png`, `verdict-look-alike.png`.

## Gotchas

- The breakdown needs the lazily loaded link parser (tldts and the Public Suffix List). It starts loading when the field gets focus, when `Paste` is used, and when the field holds a link; the region appears once it has arrived, so wait on the region, not a fixed time.
- The region exists only while the field holds a checkable link that is not already on screen. An unchecked `javascript:` or private-network value shows none, and neither does the link of the result currently shown.
- The result's breakdown is a heading, not a region, so the page never has two regions with the same name. Match the result's breakdown with `getByRole("heading", { name: "The link, taken apart" })`.
- A look-alike changes presentation only. The stored verdict and score are unchanged (see `Look-alike` in `verdict-and-signals.md`).
- The owner sentence is in the DOM twice (spoken copy and drawn copy), so `getByText(<sentence>)` matches two elements. Locate it as `p.sx-owner` (`toContainText`, `toHaveCount(1)`), as the drive does; `toContainText` on the region still works.
- Regional and tenant hosts (`acme.us.auth0.com`) are not look-alikes; a two-letter country-code run counts only for a listed brand (`amazon.de`).
