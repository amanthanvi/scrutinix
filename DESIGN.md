---
name: Scrutinix
description: "Check a link before you click. Eight independent checks, one plain verdict."
colors:
  # Light theme (:root). OKLCH is the normative source (app/globals.css).
  ground: "oklch(1 0 0)"
  surface: "oklch(1 0 0)"
  subtle: "oklch(0.972 0.003 255)"
  hairline: "oklch(0.925 0.004 255)"
  control-edge: "oklch(0.66 0.01 255)"
  control-edge-hover: "oklch(0.5 0.012 255)"
  ink: "oklch(0.2 0.012 262)"
  ink-muted: "oklch(0.45 0.014 262)"
  ink-soft: "oklch(0.54 0.012 262)"
  accent: "oklch(0.52 0.19 260)"
  accent-solid: "oklch(0.52 0.19 260)"
  accent-solid-hover: "oklch(0.46 0.18 260)"
  accent-on: "oklch(1 0 0)"
  focus-ring: "oklch(0.56 0.19 260)"
  selection: "oklch(0.88 0.06 260)"
  safe: "oklch(0.6 0.14 158)"
  safe-fg: "oklch(0.45 0.11 158)"
  safe-surface: "oklch(0.972 0.022 158)"
  safe-edge: "oklch(0.89 0.05 158)"
  suspicious: "oklch(0.64 0.15 58)"
  suspicious-fg: "oklch(0.49 0.12 55)"
  suspicious-surface: "oklch(0.975 0.026 80)"
  suspicious-edge: "oklch(0.9 0.06 75)"
  malicious: "oklch(0.58 0.2 27)"
  malicious-fg: "oklch(0.5 0.19 27)"
  malicious-surface: "oklch(0.968 0.02 22)"
  malicious-edge: "oklch(0.89 0.05 22)"
  critical: "oklch(0.5 0.2 355)"
  critical-fg: "oklch(0.46 0.19 355)"
  critical-surface: "oklch(0.965 0.022 350)"
  critical-edge: "oklch(0.88 0.055 350)"
  unknown: "oklch(0.58 0.035 250)"
  unknown-fg: "oklch(0.45 0.035 250)"
  unknown-surface: "oklch(0.968 0.008 250)"
  unknown-edge: "oklch(0.9 0.014 250)"
  error: "oklch(0.57 0.08 30)"
  error-fg: "oklch(0.47 0.08 30)"
  error-surface: "oklch(0.968 0.01 30)"
  error-edge: "oklch(0.9 0.02 30)"
  pending-surface: "oklch(0.975 0.003 255)"
  danger: "oklch(0.52 0.16 20)"
  danger-edge: "oklch(0.52 0.16 20)"
  cell-flagged: "oklch(0.58 0.2 27)"
  cell-caution: "oklch(0.615 0.15 58)"
  cell-failed: "oklch(0.55 0.012 262)"
  cell-limited: "oklch(0.58 0.035 250)"
  cell-clear: "oklch(0.61 0.008 262)"
  cell-na: "oklch(0.64 0.008 262)"
  cell-track: "oklch(0.94 0.004 255)"
  # Dark theme (.dark), designed on its own, not inverted.
  dark-ground: "oklch(0.165 0.009 264)"
  dark-surface: "oklch(0.195 0.01 264)"
  dark-subtle: "oklch(0.225 0.011 264)"
  dark-hairline: "oklch(0.27 0.012 264)"
  dark-control-edge: "oklch(0.5 0.014 264)"
  dark-control-edge-hover: "oklch(0.64 0.014 264)"
  dark-ink: "oklch(0.955 0.004 264)"
  dark-ink-muted: "oklch(0.76 0.01 264)"
  dark-ink-soft: "oklch(0.67 0.01 264)"
  dark-accent: "oklch(0.74 0.13 258)"
  dark-accent-solid: "oklch(0.56 0.18 260)"
  dark-accent-solid-hover: "oklch(0.51 0.18 260)"
  dark-accent-on: "oklch(1 0 0)"
  dark-focus-ring: "oklch(0.72 0.14 258)"
  dark-selection: "oklch(0.38 0.09 260)"
  dark-safe: "oklch(0.72 0.14 158)"
  dark-safe-fg: "oklch(0.8 0.12 158)"
  dark-safe-surface: "oklch(0.215 0.03 160)"
  dark-safe-edge: "oklch(0.32 0.055 160)"
  dark-suspicious: "oklch(0.78 0.14 72)"
  dark-suspicious-fg: "oklch(0.84 0.12 78)"
  dark-suspicious-surface: "oklch(0.22 0.032 70)"
  dark-suspicious-edge: "oklch(0.34 0.06 70)"
  dark-malicious: "oklch(0.68 0.18 25)"
  dark-malicious-fg: "oklch(0.77 0.14 25)"
  dark-malicious-surface: "oklch(0.215 0.04 22)"
  dark-malicious-edge: "oklch(0.34 0.08 22)"
  dark-critical: "oklch(0.68 0.19 355)"
  dark-critical-fg: "oklch(0.78 0.14 355)"
  dark-critical-surface: "oklch(0.215 0.042 350)"
  dark-critical-edge: "oklch(0.34 0.085 350)"
  dark-unknown: "oklch(0.66 0.035 250)"
  dark-unknown-fg: "oklch(0.78 0.03 250)"
  dark-unknown-surface: "oklch(0.21 0.014 250)"
  dark-unknown-edge: "oklch(0.31 0.02 250)"
  dark-error: "oklch(0.66 0.08 30)"
  dark-error-fg: "oklch(0.76 0.07 30)"
  dark-error-surface: "oklch(0.21 0.018 30)"
  dark-error-edge: "oklch(0.32 0.03 30)"
  dark-pending-surface: "oklch(0.19 0.01 264)"
  dark-danger: "oklch(0.74 0.12 20)"
  dark-danger-edge: "oklch(0.66 0.14 22)"
  dark-cell-flagged: "oklch(0.68 0.18 25)"
  dark-cell-caution: "oklch(0.78 0.14 72)"
  dark-cell-failed: "oklch(0.62 0.012 264)"
  dark-cell-limited: "oklch(0.6 0.035 250)"
  dark-cell-clear: "oklch(0.56 0.01 264)"
  dark-cell-na: "oklch(0.53 0.012 264)"
  dark-cell-track: "oklch(0.25 0.011 264)"
typography:
  display:
    fontFamily: "Geist, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 600
    lineHeight: 1.06
    letterSpacing: "-0.032em"
  headline:
    fontFamily: "Geist, sans-serif"
    fontSize: "2.125rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.028em"
  verdict:
    fontFamily: "Geist, sans-serif"
    fontSize: "3.25rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.036em"
  verdict-sm:
    fontFamily: "Geist, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.032em"
  score:
    fontFamily: "Geist, sans-serif"
    fontSize: "2rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: '"tnum"'
  imperative:
    fontFamily: "Geist, sans-serif"
    fontSize: "1.3125rem"
    fontWeight: 500
    lineHeight: "1.75rem"
    letterSpacing: "-0.012em"
  title:
    fontFamily: "Geist, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: "1.75rem"
    letterSpacing: "-0.012em"
  lead:
    fontFamily: "Geist, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: "1.625rem"
  body:
    fontFamily: "Geist, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: "1.5rem"
  meta:
    fontFamily: "Geist, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: "1.25rem"
  caption:
    fontFamily: "Geist, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1rem"
  link-data:
    fontFamily: "Geist Mono, monospace"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: "1.5rem"
    fontFeature: '"tnum"'
  owner-domain:
    fontFamily: "Geist Mono, monospace"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: "1.625rem"
  evidence-data:
    fontFamily: "Geist Mono, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1.25rem"
    fontFeature: '"tnum"'
rounded:
  glyph: "1.5px"
  cell: "2px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
spacing:
  column-gutter: "16px"
  column-gutter-wide: "24px"
  hero-top: "48px"
  hero-top-wide: "80px"
  tight: "12px"
  block: "24px"
  group: "32px"
  section: "40px"
  page-section: "56px"
  history-gap: "80px"
  row: "14px"
components:
  button-primary:
    backgroundColor: "{colors.accent-solid}"
    textColor: "{colors.accent-on}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.accent-solid-hover}"
    textColor: "{colors.accent-on}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "44px"
  button-outline-hover:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.ink}"
  button-ghost:
    textColor: "{colors.ink-muted}"
    typography: "{typography.meta}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "44px"
  button-ghost-hover:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.ink}"
  input-url:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.link-data}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "48px"
  tab-trigger:
    textColor: "{colors.ink-soft}"
    height: "44px"
  tab-trigger-active:
    textColor: "{colors.ink}"
    height: "44px"
  verdict-band-pending:
    backgroundColor: "{colors.pending-surface}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.verdict}"
    rounded: "{rounded.xl}"
    padding: "28px"
  verdict-band-safe:
    backgroundColor: "{colors.safe-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.verdict}"
    rounded: "{rounded.xl}"
    padding: "28px"
  verdict-band-suspicious:
    backgroundColor: "{colors.suspicious-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.verdict}"
    rounded: "{rounded.xl}"
    padding: "28px"
  verdict-band-malicious:
    backgroundColor: "{colors.malicious-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.verdict}"
    rounded: "{rounded.xl}"
    padding: "28px"
  verdict-band-critical:
    backgroundColor: "{colors.critical-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.verdict}"
    rounded: "{rounded.xl}"
    padding: "28px"
  verdict-band-unknown:
    backgroundColor: "{colors.unknown-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.verdict}"
    rounded: "{rounded.xl}"
    padding: "28px"
  verdict-band-error:
    backgroundColor: "{colors.error-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.verdict}"
    rounded: "{rounded.xl}"
    padding: "28px"
  strip-cell:
    backgroundColor: "{colors.cell-track}"
    rounded: "{rounded.cell}"
    height: "12px"
  glyph-cell:
    backgroundColor: "{colors.cell-track}"
    rounded: "{rounded.glyph}"
    size: "7px"
  evidence-row:
    textColor: "{colors.ink-muted}"
    padding: "14px 0"
  evidence-plate:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.evidence-data}"
    rounded: "{rounded.md}"
    padding: "12px 14px"
  history-row:
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 8px"
    height: "48px"
---

# Design System: Scrutinix

## Overview

**Creative North Star: "The Plain Answer"**

Scrutinix is the canonical minimal product tool, played straight at Linear and Vercel craft level and made sharper. A person holding a suspicious link gets one answer, said plainly and big, on a precise instrument: a cool, crisp white ground (light) or a deep neutral-cool ground (dark), near-black ink, hairline structure, one static blue accent, and verdict colour only where a verdict is stated. Each theme is designed on its own; dark is not an inversion.

The page is one centred column that reads top to bottom as the task does: a display headline and one supporting line, the Single/Batch scan form, then the verdict band, the link anatomy (who really owns the link), the eight-cell strip, the Summary/Full evidence rows, the actions, and local history. Density is calm at rest and exact under load: UI type sits on tight 12–17px steps, while the headline and the verdict word jump to display sizes so the answer outranks the chrome. Nothing is costume. Monospace appears only where the content is data.

The signature is the eight-cell strip. One cell per check, in a fixed order, with a fixed shape for every state. It is the streaming progress, the evidence index, the row marker, the history and batch glyph, the brand mark, the app icon, and the share-image motif: one grammar at every scale.

**Provenance.** Chosen on 2026-10-06 after a critique called the previous minimal build bland and underwhelming. Three committed alternate worlds were dealt and drafted live (Label, Signage, Line; seed `ccccb7f7`); the user chose the standing exit, the category canon, with a cool white light ground instead of warm paper and no grafts of the drafts' world-specific presentations. Direction contract: `.impeccable/surfaces/app-page-tsx.md`.

**Key Characteristics:**

- One 46rem column; the verdict band is the only tinted container.
- Cool white / deep neutral-cool grounds, blue-black ink, one blue accent for actions, links, and focus.
- Geist Sans on a real scale with confident display steps; Geist Mono for links, domains, evidence, and counts.
- Verdict hue appears as a low-chroma band surface; the verdict word itself stays ink.
- The eight-cell strip carries every state by shape as well as hue.
- CSS-only motion under 300ms with one authored moment: the cells fill, then the band takes its colour and the verdict word arrives.
- Browser surfaces are themed: selection, caret, scrollbars, focus rings, underline offset, tabular numerals.

### Motion

All motion lives in `app/scrutinix.css`, is CSS-only, eases out on `cubic-bezier(0.23, 1, 0.32, 1)` from an already-visible default, and stays under 300ms.

- **The authored moment.** Cells fill in place as checks land (a 260ms `scaleX` from the left on the cell's fill layer). When the verdict lands, the band's background and edge cross-fade from the Checking surface to the verdict surface (280ms) and the verdict word arrives with a 240ms fade and 6px rise (`@starting-style`).
- **Entrances.** Rows and the batch list use a 200ms fade and 4px rise. Only the initial pending rows stagger (40ms each); resolving rows enter instantly.
- **The one loop.** A still-running cell (and a batch row still checking) breathes in opacity on a 1.2s loop. Nothing else repeats.
- **Controls.** Buttons press to `scale: 0.97` over 160ms; disclosure chevrons rotate 90° over 200ms; strip cells and rows take a 160ms hover plate. Tab switches and input focus do not animate.
- **Reduced motion.** `prefers-reduced-motion: reduce` removes translation, the loop, the cell fill, the band cross-fade, chevron rotation, and button scale; entrances keep a 150ms opacity fade; smooth scrolling turns off.

## Colors

A cool, nearly achromatic system with one blue voice and six verdict families that speak only when a verdict is stated. OKLCH in `app/globals.css` is the normative source; every pair below is asserted by `scripts/check-contrast.mjs` in both themes.

### Primary

- **Signal Blue** (`accent`): links, the active tab and Summary/Full underline, the caret. In dark it lifts to a lighter blue so link text keeps 4.5:1 on the deep ground.
- **Signal Blue Solid** (`accent-solid`, pressed `accent-solid-hover`): the filled primary button (Analyze at rest, Start batch, Run a fresh scan, Reload page) with white label (`accent-on`). Dark keeps a mid blue so the white label stays AA.
- **Focus Blue** (`focus-ring`): every focus ring, and the edge a focused field takes.
- **Selection Wash** (`selection`): text selection behind ink.

### Neutral

- **Crisp White Ground** / **Deep Cool Ground** (`ground`, `dark-ground`): the page. Light is pure white; dark is a deep blue-leaning neutral, also the dark `theme-color`.
- **Field White** / **Raised Field** (`surface`): inputs, outline buttons, the skip link. Identical to the ground in light; one step up in dark.
- **Cool Mist** (`subtle`): hover plates behind rows, strip cells, and ghost buttons; the evidence plate inside an opened row.
- **Hairline Gray** (`hairline`): every divider and rule (header, footer, tab list, row lists).
- **Control Edge** (`control-edge`, hover `control-edge-hover`): the 1px border on fields and outline buttons, held at 3:1 on the ground.
- **Blue-Black Ink** (`ink`), **Graphite** (`ink-muted`), **Soft Slate** (`ink-soft`): primary text, secondary text, and quiet text (placeholders, cell names, timestamps). All three keep 4.5:1 on the ground, the field, and the hover plate.

### Verdict (semantic)

Each verdict owns four tokens: a graphic hue (`<v>`, 3:1 on the ground), a text hue (`<v>-fg`, 4.5:1 on the ground), a low-chroma band surface (`<v>-surface`), and its 1px band edge (`<v>-edge`). Ink, secondary ink, links, and focus all stay AA on every surface.

- **Safe Green**: a stated Safe verdict only.
- **Suspicious Amber**, **Malicious Red**, **Critical Magenta**: the three warning verdicts, stepping in hue rather than shouting in chroma.
- **Unknown Slate**: its own slate pair, never the accent blue. Also the tone a look-alike Safe takes (band, row word, share card).
- **Error Clay**: a failed scan, desaturated so it never reads as a threat; the error boundary borrows its surface.
- **Checking Band** (`pending-surface`): the band while checks run, a hair off the ground.

### Strip ramp (semantic)

`cell-flagged` (the Malicious graphic), `cell-caution` (amber), `cell-limited` (slate, a partial answer), `cell-failed` and `cell-clear` and `cell-na` (three grays), on `cell-track`. Every mark keeps 3:1 against the ground, the track, and the hover plate.

### UI danger (semantic)

- **UI Danger** (`danger`, `danger-edge`): form errors, stream errors, an invalid field's border, and the destructive "Confirm clear". It is not a verdict colour.

### Named Rules

**The Verdict-Only Hue Rule.** Verdict hues appear only where a verdict is stated: the band surface, a history or batch row's verdict word, the share card. Chrome never re-tints; the accent is static.

**The Gray-Means-Nothing Rule.** A check that found nothing is gray (`cell-clear`), never green. Green belongs to a stated Safe verdict, so a quiet source never reads as an endorsement beside a Malicious answer.

**The Danger Is Not a Verdict Rule.** UI failures use `danger`/`danger-edge`. Never borrow `malicious-*` for a form error or a destructive confirm.

**The Guarded Pair Rule.** A new token ships with its pairs added to `PAIRS` in `scripts/check-contrast.mjs`: 4.5:1 for text, 3:1 for graphics and control edges, in both themes. The unit suite fails otherwise.

## Typography

**Display Font:** Geist Sans (self-hosted through the `geist` package, `--font-geist-sans`)
**Body Font:** Geist Sans
**Label/Mono Font:** Geist Mono (`--font-geist-mono`)

**Character:** One neo-grotesque family does everything a word does; its mono sibling does everything a measurement does. The pairing reads as a precise instrument, not a terminal.

### Hierarchy

- **Verdict** (600, 52px from 40rem, 40px below; line-height 1; −0.036em / −0.032em): the verdict word in the band, the largest type on any result.
- **Display** (600, 44px, 1.06, −0.032em): the home headline and public page titles from 40rem.
- **Headline** (600, 34px, 1.1, −0.028em): the same headlines on phones, and the home headline once a verdict band is on the page.
- **Score** (500, 32px, 1, −0.02em, tabular): the threat score numeral. Set in Geist Sans because Geist Mono's slashed zero reads as "Ø" at this size; the "/100" beside it is mono meta.
- **Imperative** (500, 21px, 28px, −0.012em): the one instruction under the verdict word ("Don't open this link.").
- **Title** (600, 20px, 28px, −0.012em): History, batch, and public-page section headings.
- **Lead** (400, 17px, 26px): the supporting line under a headline; also the registered domain in the anatomy line (mono, 600).
- **Body** (400, 15px, 24px): sentences, summaries, caveats, public prose (at 30rem: 63–73 characters per rendered line).
- **Meta** (13px, 20px; 500 on controls): buttons, nav, tabs' hint, confidence line, the Evidence heading (600).
- **Caption** (12px, 16px): strip cell names, timestamps, evidence entries (mono).

### Named Rules

**The One Display Moment Rule.** Once the verdict band mounts, the home headline steps down from display to headline size (CSS `:has(#sx-verdict-heading)` from 40rem), so one display size owns the moment. The step happens when the scan starts, never after the verdict lands.

**The Mono Is Data Rule.** Geist Mono sets links, registered domains, evidence entries, counts, scores' "/100", and timestamps, always with tabular numerals. Never use it to make prose look technical.

**The Taught Scale Rule.** Every custom `text-*` step lives in `@theme` and is registered with tailwind-merge in `lib/utils.ts`; otherwise `cn()` silently drops it when a colour class follows.

## Layout

One centred column, `max-width: 46rem`, with 16px gutters (24px from 40rem). The header (56px) and footer share the column; each is separated from the page by a single hairline. The home page opens 48px below the header (80px from 40rem); headline, supporting line (12px below, capped at 34rem), and the form (32px, then 40px from 40rem) sit together so the tabs, the URL field, Paste, and a ready Analyze button are in the first viewport on desktop and phone.

The results stack follows a fixed rhythm: verdict band, link anatomy 24px below, strip 32px below, the Evidence block 40px below, verdict details 24px below, actions 16px below. History begins 80px below the results and collapses that gap entirely when it has nothing to draw. Public pages (`/about`, `/privacy`) use the same column and header: display title, lead at the prose measure, then one hairline and sections 56px apart.

Responsive behaviour: the band's score moves from beside the verdict word (from 40rem) to a baseline row under it; signal-row labels stack above their finding below 40rem; history and batch rows wrap the link onto its own full-width second line on phones; the strip is a 4 × 2 grid below 48rem and a single row of eight from 48rem. The page scrolls as one document: no sticky rails, no inner scroll areas. `scrollbar-gutter: stable` keeps the column still as results grow.

### Named Rules

**The No-Reflow Rule.** Streaming never moves what is above the strip. Cells fill in place; the anatomy's fact slots are held open ("Checking…") until the scan ends; Cancel lives inside the Checking band; the band keeps a slot for its confidence line so the verdict changes the band's tone, not its height.

## Elevation & Depth

Flat by default. Depth comes from type scale, spacing, hairline dividers, and one tonal device: the verdict band's low-chroma surface with its 1px edge. Hover is a Cool Mist plate, not a lift. Focus is a 2px Focus Blue outline offset 2px (fields take it flush on their own edge). There are no shadows, gradients, glass, or glows in the system.

### Named Rules

**The One Tinted Surface Rule.** The verdict band is the only tinted, bordered container on a result. The error boundary reuses its shape on the Error surface. Everything else is type on the ground, divided by hairlines.

## Shapes

Gently rounded and exact. Controls use a 6px radius (`rounded.md`); the verdict band and the error boundary use 12px (`rounded.xl`). Strip cells are 2px-rounded slots; history and batch glyph cells are 7px squares at 1.5px. Borders are always 1px: hairlines for structure, Control Edge for fields and outline buttons, the verdict edge for the band. Tabs and the Summary/Full switch mark selection with a 2px underline, never a pill.

The brand mark is the strip folded 4 × 2 (six-unit cells, two-unit gaps, one-unit radius) from `lib/brand-mark.ts`, drawn in ink in the header and on share cards, and on a 22%-rounded ink tile for app icons.

### Named Rules

**The Shape Before Hue Rule.** No two strip states differ by colour alone: flagged is a solid block, caution is a −45° hatch, found-nothing is a thin centred dash, a partial answer is a centred short block (never a length that reads as progress), failed is a 1.5px inset outline, didn't-apply is a dashed outline, and still-running is the bare track. Under forced colours the cells redraw the same shapes in system colours. The hatch is the only repeating-gradient pattern in the system and lives only inside cells.

## Components

### Buttons

- **Shape:** 6px radius, 1px border (transparent unless outlined), 44px minimum target; meta type at 500.
- **Primary:** Signal Blue Solid with a white label. Analyze is 48px tall beside the field and is never disabled at rest (an empty submit explains itself inline); while a scan runs it is `aria-disabled`, not disabled, so focus stays. While a result is on screen it drops to the outline style so the verdict owns the colour; editing the field restores it.
- **Outline:** Field White with a Control Edge border, ink label; hover darkens the edge and lays a Cool Mist plate. Used for result actions (Download result (JSON), Share, Re-scan).
- **Ghost:** no fill, Graphite label; hover lays Cool Mist and inks the label. Used for Paste, exports, Clear/Undo, Cancel, batch Open.
- **Press:** `scale: 0.97` over 160ms. Every export names its scope (result, batch, history).

### Inputs / Fields

- **Style:** Field White, 1px Control Edge, 6px radius, 14px horizontal padding. The URL field is 48px tall and set in mono at body size; placeholder "Paste a link" in Soft Slate. Paste sits inside its right edge only where the browser can read the clipboard.
- **Focus:** the border turns Focus Blue with the 2px outline flush on it (offset 0).
- **Error:** the border turns UI Danger and a plain danger-coloured line appears beneath (`role="alert"`); never a callout box.

### Tabs (Single / Batch) and the Summary/Full switch

Text triggers on a hairline baseline, 44px tall. Inactive is Soft Slate; active is ink with a 2px Signal Blue underline. Batch carries an "up to 10 links" hint outside its accessible name. The Summary/Full switch uses the same text-option look as one `role="switch"`.

### Navigation

The header is the column at 56px: the eight-square mark and the "Scrutinix" wordmark (15px, 600, −0.015em; a home link off the home page), then About, Privacy (meta, Graphite to ink on hover, ink when current), and the theme toggle. The footer is one meta line on a hairline: name, About, Privacy, Source, and "Free and open source. No account needed."

### Verdict band (signature, S1)

A column-wide section on `<verdict>-surface` with its 1px `<verdict>-edge`, 12px radius, 28px padding (20px × 24px on phones). Inside: the verdict word in ink at Verdict size (`h2#sx-verdict-heading`, focusable), the imperative directly beneath, and on the right the score numeral with its band text ("Malicious band 55–79") only when `getVerdictGuidance().showScore` (never for Unknown or Error). Below: a "because" sentence only when Summary shows no driver row, a coverage caveat in Graphite only when coverage was limited, then the confidence line with "How scoring works". While checks run, the same element tree reads "Checking" in Soft Slate on the Checking surface, with "3 of 8 checks finished" and Cancel scan, so focus survives the switch. A look-alike Safe keeps its word and score but takes the Unknown surface and "No check flagged it, but the name is misleading." Shared snapshots show the hedged imperative, no score, and "Run a fresh scan". "How we reached this verdict" is a native disclosure below the evidence, never between the band and its evidence. Every verdict string comes from `lib/domain/verdict-guidance.ts` and `lib/domain/verdict.ts`.

### Link anatomy (signature, S2)

The link taken apart in mono at body size: scheme and path in Soft Slate, subdomain in Graphite, and the registered domain (the real owner) in ink at lead size, 600, never split mid-name unless it cannot fit. An ignored login name is struck through. A long path truncates with a "Show full link" toggle. A look-alike gets one plain sentence ("This link belongs to secure-login.xyz, not paypal.com.") with both domains in mono, said once on the page. Beneath, a small two-column list keys facts to the segment they describe (`https://` for a certificate problem, the domain for a young registration, "Ends at" for a redirect to another host), only when the fact matters and its evidence row isn't already on screen. In history and batch rows the compact form drops the scheme, truncates the subdomain from its left and the path first, and never truncates the owner.

### Eight-cell strip (signature, S3)

- **Live strip:** a `role="toolbar"` of eight cell controls (12px-tall cells with their short names in caption type beneath), four columns below 48rem and eight from 48rem. Names of flagged, caution, and failed checks go to ink at 500; the rest stay Soft Slate. Each cell is a named control ("Redirects: …") that reveals, opens, and focuses its evidence row; arrows, Home, and End move a roving tabindex.
- **Snapshot strip:** the same grid drawn settled from a stored signature, as a list with real text for each state.
- **Row marker:** a 14 × 8px cell leads each evidence row, so row and strip cell read as one thing.
- **Glyph:** eight 7px cells with 2px gaps in history and batch rows; entries saved before signals were kept draw empty slots and a plain note, never eight failed cells.
- **Mark, icon, share card:** the idealized strip (every cell filled in ink), folded 4 × 2 for the mark and icons, and one row of eight on the default share card.

### Evidence rows

An Evidence heading (meta, 600) with the Summary/Full switch on a hairline, then a `<ul>` divided by hairlines. Each row: the cell marker, the signal label (14px, 500, ink, a 176px column from 40rem), the finding as a plain sentence in Graphite (wraps, never truncates), and a chevron when evidence exists. Opening a row reveals a Cool Mist evidence plate (6px radius) holding a mono key/value list; timing lives only there. Summary shows only the checks that drove the verdict and folds the rest into one line ("7 other checks found nothing. Show all checks").

### History and batch

Hairline-divided lists with one row grammar (`result-row.tsx`): glyph, verdict word in its `-fg` colour (a look-alike Safe in Unknown slate), the compact anatomy, and a trailing timestamp (history) or Open (batch). Rows are 48px minimum; history rows are whole-row buttons with a Cool Mist hover plate. History draws nothing when empty (the landmark stays); a filter field appears past three entries; clearing confirms in UI Danger and offers Undo. Batch has a title and a mono "3/10" count on a hairline and a hidden-on-phone index column.

### Share images

1200 × 630 cards rendered by `lib/og/cards.tsx` in the light theme with bundled Geist and Geist Mono (hex equivalents of the light tokens; Satori reads neither OKLCH nor variables). The default card: mark and wordmark, the headline in explicit lines at 84px, the supporting line, the ink strip, "scrutinix.net". A shared result card: the verdict band (word at 104px, imperative at 36px) on its surface and edge, the registered domain in mono (or the ownership sentence for a look-alike), and the result's strip with cell names, shapes mirrored from the live strip.

### Accessibility contract (tests depend on these)

- Landmarks and targets: skip link to `#main-content`; `id="scan-console"`; band `section` named "Scan result: {verdict}" (or "Scanning URL"); focusable `h2#sx-verdict-heading`; region "Scan history" with heading "History (N scans)" and filter `#sx-history-filter`; region "Batch scan results".
- Names: textboxes "URL to analyze" / "URLs to analyze, one per line"; buttons Analyze URL, Start batch, Clear all history, Confirm clear all history, Undo clear history, Show all checks, Run a fresh scan, "Open result for {link}"; `role="meter"` "Threat score" (scored verdicts only, `aria-valuetext` "73 out of 100"); `role="switch"` whose name starts with its visible labels ("Summary Full signal list", WCAG 2.5.3); toolbar "Checks"; list "Signals"; each row named "{Label} signal: {finding}" on its `<summary>` (or its `<li>` when it has no evidence).
- Announcements: one polite live region, never remounted, reports progress ("3 of 8 checks finished.") and `getVerdictAnnouncement` on completion, waiting for the link parser so a look-alike is spoken with its hedge. Opening a stored result moves focus to the verdict heading and blanks the region for 100ms so an identical announcement is spoken again.
- Focus: Re-scan and "Run a fresh scan" park focus on the band heading (the same node from Checking to verdict); Cancel returns it to the field; a landed scan off-screen scrolls into view (instantly under reduced motion); revealing quiet checks focuses the first newly revealed row, with the list as fallback.
- Floors: 44px targets; colour never carries meaning alone; coloured text uses `-fg` tokens; axe at zero violations on the empty page and on results in both themes; Lighthouse Accessibility ≥ 0.95.

## Do's and Don'ts

### Do:

- **Do** keep one 46rem column in the order headline → form → verdict band → link anatomy → strip → evidence → actions → history.
- **Do** state each fact once: one score, one severity per signal, the owner sentence once.
- **Do** put verdict hue on the band surface and keep the verdict word in ink.
- **Do** draw every new strip state with its own shape and add its pair to the contrast guard.
- **Do** use the strip's grammar wherever a result is summarized: history, batch, share cards, icons.
- **Do** theme every browser surface from the palette: selection, caret, scrollbar, focus, tabular numerals.
- **Do** design light and dark separately and check both at every change.

### Don't:

- **Don't** use casefile, dossier, or stamp costume; terminal, CRT, radar, or glow theater; or cream-and-purple SaaS.
- **Don't** warm the light ground into paper; it is cool, crisp white.
- **Don't** graft the dealt drafts' presentations: no disclosure-label panel, no road signs, no transit line.
- **Don't** add score rings, gauges, threat-level bars, or stacked per-signal badges repeating one fact.
- **Don't** wrap content in cards or callout boxes; the verdict band is the only tinted container, and errors are plain lines of text.
- **Don't** use pill tab bars or segmented pills; selection is a 2px underline.
- **Don't** add taglines, kickers, stat bands, or feature grids around the one plain headline.
- **Don't** colour a found-nothing check green, or a UI error with a verdict red.
- **Don't** add shadows, gradients, glass, or glows; hover is a Cool Mist plate.
- **Don't** set prose in mono or put a second infinite animation on the page.
