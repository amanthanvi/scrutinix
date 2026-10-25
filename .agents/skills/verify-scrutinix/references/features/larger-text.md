# Larger text

A reader who raises the browser's default text size gets larger text that reflows into the column: nothing scrolls sideways, at any width, on the home page, a result with every check open, history, shared links, `/about`, and `/privacy`.

## Sub-features

- home: the headline, form, and tabs wrap at 200% on a 320px-wide phone
- result: the band (its verdict word grows, never shrinks, and wraps inside the band), the link taken apart, the strip, and every Full row with its evidence open
- public-pages: `/about`'s fixed-layout scoring tables and every disclosure open, and `/privacy`

## How to get to it (user POV)

Raise the browser's default font size (Chrome: Settings, Appearance, Font size; a phone's text-size setting). Page zoom is a different setting and is not this check: zoom shrinks the viewport, a larger default text size grows `rem` while the viewport stays.

## Driving it with Playwright

`npm run verify:drive` test `larger default text reflows without sideways scrolling`. `setDefaultTextSize(page, 32)` (re-exported from `tests/e2e/helpers.ts` by `scripts/support.ts`) sets Chromium's default text size over CDP, the same setting a reader changes.

```ts
await page.setViewportSize({ width: 320, height: 700 });
await setDefaultTextSize(page, 32);
await gotoApp(page);
const sideways = () =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
expect(await sideways()).toBe(false);
```

Then scan `https://critical.scrutinix.test/login`, switch to Full, open every `details`, and check again; then `/about` and `/privacy` with every `details` open.

Screenshots: `reflow-result.png`, `reflow-privacy.png`.

## Gotchas

- Set the text size before the page that is measured: the CDP setting lasts for the page across navigations, and the drive sets it once before `gotoApp`.
- `setDefaultTextSize` is Chromium-only (CDP). The skill's Playwright project is Chromium. The e2e suite instead requests the `pageAtDefaultTextSize` fixture (`test` from `tests/e2e/helpers.ts`), which also sets Firefox's own preference; Safari has no default text size, so those tests are skipped in WebKit.
- The full matrix (16 to 32px text at several widths, phone emulation, filtered history, verified, unverified, and expired shared look-alikes, plus page zoom at 320px) is `tests/e2e/accessibility.smoke.spec.ts`. The drive proves the hardest single case; run `npm run test:e2e` when a layout change needs the matrix, and `npm run test:e2e:engines` for Firefox and WebKit too: Firefox once pushed a Summary "From" line past a 320px screen at 200% text where Chromium did not.
