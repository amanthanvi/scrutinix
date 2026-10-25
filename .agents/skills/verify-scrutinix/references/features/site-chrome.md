# Site chrome

The frame around every page: skip link, wordmark, About and Privacy, theme control, footer, and the framework 404 for unknown paths.

## Sub-features

- skip-link: first Tab stop is `Skip to content`, targeting `#main-content`
- header: wordmark, navigation `Primary` (About, Privacy, the theme button)
- keyboard: Tab order is Skip to content, About, Privacy, the theme button, then tab `Single`; the arrow keys move between `Single` and `Batch`
- headline: the home `<h1>` is `Is this link what it says it is?`, in the Newsreader display serif
- previews: the headline is the site's line everywhere it is stated. The title (and `og:title`, `twitter:title`) is `Scrutinix — Is this link what it says it is?` on `/` and on a shared link that isn't verified or has expired; `og:description` and `twitter:description` are `Eight separate checks, one plain verdict.`; `og:image` points at `/opengraph-image`, the default card with the headline in two lines (`Is this link` / `what it says it is?`) and the alt text `Scrutinix: Is this link what it says it is?` followed by the card's supporting line; the `public/site.webmanifest` description is `Is this link what it says it is? Eight separate checks, one plain verdict.` `/about` and `/privacy` have their own titles and inherit the same `og:` and `twitter:` lines.
- footer: the wordmark, navigation `Footer` with About, Privacy, and Source, and `Free and open source. No account needed.`
- not-found: unknown paths render the framework 404

## How to get to it (user POV)

Open `/`. The wordmark on the home page is text, not a link. On `/about` and `/privacy` the wordmark is the link `Scrutinix home` back to `/`. Tab once from the top of the home page to focus Skip to content; keep tabbing through About, Privacy, and the theme button to the Single tab. The footer is the last landmark.

## Driving it with Playwright

`npm run verify:drive` test `site chrome and theme`, plus the navigation in `about and privacy`.

- `page.getByRole("heading", { level: 1, name: "Is this link what it says it is?" })`
- `expect(page).toHaveTitle("Scrutinix — Is this link what it says it is?")`; the e2e test `every preview of the site states the home headline` (`tests/e2e/app.smoke.spec.ts`) checks the `og:`/`twitter:` tags, the card's lines, and the manifest against the `<h1>`
- `page.getByRole("link", { name: "Skip to content" })` after one Tab, then About and Privacy in `page.getByRole("navigation", { name: "Primary" })`, the theme button, and `page.getByRole("tab", { name: "Single" })`; ArrowRight focuses tab `Batch`
- `page.getByRole("navigation", { name: "Footer" })` has links `About`, `Privacy`, and `Source`
- The empty `Scan history` region is attached and draws nothing
- `page.goto("/no-such-scrutinix-page")` shows `This page could not be found.`
- From `/privacy`, `page.getByRole("link", { name: "Scrutinix home" })` returns to the scan console

Screenshots: `chrome-theme.png`, `not-found.png`.

## Gotchas

- The theme button's accessible name is `Toggle theme` until the client has mounted, then `Switch to light theme` or `Switch to dark theme`. Wait for the settled name before clicking. `gotoApp` (and `waitForHydration`) in `scripts/support.ts` do this.
- As soon as the band is on the page (the `Checking` band included), the home `<h1>` is visually hidden (it stays in the outline) and the lead sentence under it goes, so the verdict owns the first view. Assert the headline before a scan, not after.
- A shared result link (`/?shared=…`) has no visible headline: its `<h1>` is the visually hidden `A link shared with you`, and the form sits under the h2 `Check another link`.
- Next.js dev adds a small dev-tools badge. Click by role, not by coordinates.
