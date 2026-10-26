# Theme

Light and dark appearance, stored in this browser.

## Sub-features

- toggle: one header button flips the theme
- persistence: the choice survives reload

## How to get to it (user POV)

The button sits in the header after Privacy. Its name is `Switch to light theme` when the page is dark, and `Switch to dark theme` when the page is light (its `aria-label`; the hover tooltip is a `title` on an `aria-hidden` layer over the button, so it is not read again as a description). Click it. Reload the page. The same theme is still applied.

## Driving it with Playwright

`npm run verify:drive` test `site chrome and theme`.

```ts
const toggle = page.getByRole("button", {
  name: /switch to (light|dark) theme/i,
});
await toggle.click();
const stored = await page.evaluate(() => localStorage.getItem("theme"));
await page.reload();
```

End state: `stored` is `light` or `dark`, the button name matches the opposite theme, and `html` `class` contains that stored value.

Screenshot: `chrome-theme.png`.

## Gotchas

- Do not assume the first theme. The default is `system`, and Playwright emulates `prefers-color-scheme: light` unless a test sets `colorScheme`, so a fresh drive context usually starts light; read the button's name instead of assuming.
- The storage key is `theme` (`next-themes` default). There is no Scrutinix-specific key.
- A fresh Playwright context has an empty `localStorage`. Theme does not leak into the next test.
