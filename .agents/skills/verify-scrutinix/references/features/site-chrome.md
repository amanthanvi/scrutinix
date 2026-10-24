# Site chrome

The frame around every page: skip link, wordmark, About and Privacy, theme control, footer, and the framework 404 for unknown paths.

## Sub-features

- skip-link: first Tab stop is `Skip to content`, targeting `#main-content`
- header: wordmark, primary nav, theme button
- footer: navigation `Footer` with About, Privacy, and Source
- not-found: unknown paths render the framework 404

## How to get to it (user POV)

Open `/`. The wordmark on the home page is text, not a link. On `/about` and `/privacy` the wordmark is the link `Scrutinix home` back to `/`. Tab once from the top of the home page to focus Skip to content. The footer is the last landmark.

## Driving it with Playwright

`npm run verify:drive` test `site chrome and theme`, plus the navigation in `about and privacy`.

- `page.getByRole("link", { name: "Skip to content" })` after one Tab
- `page.getByRole("navigation", { name: "Primary" })`
- `page.getByRole("navigation", { name: "Footer" })` has links `About` and `Source`
- The empty `Scan history` region is attached and draws nothing
- `page.goto("/no-such-scrutinix-page")` shows `This page could not be found.`
- From `/privacy`, `page.getByRole("link", { name: "Scrutinix" })` (accessible name `Scrutinix home`) returns to the scan console

Screenshot: `chrome-theme.png`, `not-found.png`.

## Gotchas

- The theme button's accessible name is `Toggle theme` until the client has mounted, then `Switch to light theme` or `Switch to dark theme`. Wait for the settled name before clicking. `gotoApp` in `scripts/support.ts` does this.
- The home `<h1>` is `Check a link before you click.` Once a verdict mounts, it steps down to headline size so the verdict owns the display moment.
- Next.js dev adds a small dev-tools badge. Click by role, not by coordinates.
