---
name: Scrutinix
description: "Is this link what it says it is? Eight separate checks, one plain answer, every source named."
colors:
  # Light theme (:root). OKLCH is the normative source (app/globals.css).
  ground: "oklch(0.99 0.003 250)"
  surface: "oklch(1 0 0)"
  subtle: "oklch(0.965 0.004 255)"
  hairline: "oklch(0.9 0.005 255)"
  control-edge: "oklch(0.64 0.01 255)"
  control-edge-hover: "oklch(0.5 0.012 255)"
  ink: "oklch(0.2 0.012 262)"
  ink-muted: "oklch(0.44 0.013 262)"
  ink-soft: "oklch(0.52 0.012 262)"
  accent: "oklch(0.46 0.16 262)"
  focus-ring: "oklch(0.46 0.16 262)"
  selection: "oklch(0.9 0.05 262)"
  button: "oklch(0.2 0.012 262)"
  button-hover: "oklch(0.34 0.014 262)"
  button-on: "oklch(1 0 0)"
  safe: "oklch(0.6 0.14 158)"
  safe-fg: "oklch(0.45 0.11 158)"
  safe-surface: "oklch(0.972 0.022 158)"
  safe-edge: "oklch(0.89 0.05 158)"
  safe-ink: "oklch(0.42 0.04 158)"
  suspicious: "oklch(0.64 0.15 58)"
  suspicious-fg: "oklch(0.49 0.12 55)"
  suspicious-surface: "oklch(0.975 0.026 80)"
  suspicious-edge: "oklch(0.9 0.06 75)"
  suspicious-ink: "oklch(0.42 0.04 62)"
  malicious: "oklch(0.56 0.2 27)"
  malicious-fg: "oklch(0.5 0.19 27)"
  malicious-surface: "oklch(0.962 0.024 22)"
  malicious-edge: "oklch(0.88 0.05 22)"
  malicious-ink: "oklch(0.42 0.04 22)"
  critical: "oklch(0.5 0.2 355)"
  critical-fg: "oklch(0.46 0.19 355)"
  critical-surface: "oklch(0.965 0.022 350)"
  critical-edge: "oklch(0.88 0.055 350)"
  critical-ink: "oklch(0.42 0.04 352)"
  unknown: "oklch(0.58 0.035 250)"
  unknown-fg: "oklch(0.45 0.035 250)"
  unknown-surface: "oklch(0.968 0.008 250)"
  unknown-edge: "oklch(0.9 0.014 250)"
  unknown-ink: "oklch(0.42 0.03 250)"
  error: "oklch(0.57 0.08 30)"
  error-fg: "oklch(0.47 0.08 30)"
  error-surface: "oklch(0.968 0.01 30)"
  error-edge: "oklch(0.9 0.02 30)"
  error-ink: "oklch(0.42 0.03 30)"
  pending-surface: "oklch(0.972 0.004 255)"
  danger: "oklch(0.52 0.16 20)"
  danger-edge: "oklch(0.52 0.16 20)"
  cell-flagged: "oklch(0.56 0.2 27)"
  cell-caution: "oklch(0.62 0.15 58)"
  cell-failed: "oklch(0.55 0.012 262)"
  cell-limited: "oklch(0.58 0.035 250)"
  cell-clear: "oklch(0.6 0.008 262)"
  cell-na: "oklch(0.62 0.008 262)"
  cell-track: "oklch(0.945 0.004 255)"
  # Dark theme (.dark), designed on its own: warm paper ink on a cool ground.
  dark-ground: "oklch(0.17 0.007 258)"
  dark-surface: "oklch(0.205 0.008 258)"
  dark-subtle: "oklch(0.225 0.009 258)"
  dark-hairline: "oklch(0.3 0.009 258)"
  dark-control-edge: "oklch(0.52 0.012 258)"
  dark-control-edge-hover: "oklch(0.66 0.012 258)"
  dark-ink: "oklch(0.95 0.006 90)"
  dark-ink-muted: "oklch(0.77 0.008 90)"
  dark-ink-soft: "oklch(0.67 0.008 260)"
  dark-accent: "oklch(0.76 0.12 258)"
  dark-focus-ring: "oklch(0.76 0.12 258)"
  dark-selection: "oklch(0.36 0.08 260)"
  dark-button: "oklch(0.95 0.006 90)"
  dark-button-hover: "oklch(0.84 0.008 90)"
  dark-button-on: "oklch(0.17 0.007 258)"
  dark-safe: "oklch(0.72 0.14 158)"
  dark-safe-fg: "oklch(0.8 0.12 158)"
  dark-safe-surface: "oklch(0.215 0.03 160)"
  dark-safe-edge: "oklch(0.32 0.055 160)"
  dark-safe-ink: "oklch(0.82 0.03 158)"
  dark-suspicious: "oklch(0.78 0.14 72)"
  dark-suspicious-fg: "oklch(0.84 0.12 78)"
  dark-suspicious-surface: "oklch(0.22 0.032 70)"
  dark-suspicious-edge: "oklch(0.34 0.06 70)"
  dark-suspicious-ink: "oklch(0.82 0.03 72)"
  dark-malicious: "oklch(0.68 0.18 25)"
  dark-malicious-fg: "oklch(0.77 0.14 25)"
  dark-malicious-surface: "oklch(0.22 0.038 22)"
  dark-malicious-edge: "oklch(0.34 0.07 22)"
  dark-malicious-ink: "oklch(0.82 0.03 22)"
  dark-critical: "oklch(0.68 0.19 355)"
  dark-critical-fg: "oklch(0.78 0.14 355)"
  dark-critical-surface: "oklch(0.215 0.042 350)"
  dark-critical-edge: "oklch(0.34 0.085 350)"
  dark-critical-ink: "oklch(0.82 0.03 352)"
  dark-unknown: "oklch(0.66 0.035 250)"
  dark-unknown-fg: "oklch(0.78 0.03 250)"
  dark-unknown-surface: "oklch(0.21 0.014 250)"
  dark-unknown-edge: "oklch(0.31 0.02 250)"
  dark-unknown-ink: "oklch(0.82 0.02 250)"
  dark-error: "oklch(0.66 0.08 30)"
  dark-error-fg: "oklch(0.76 0.07 30)"
  dark-error-surface: "oklch(0.21 0.018 30)"
  dark-error-edge: "oklch(0.32 0.03 30)"
  dark-error-ink: "oklch(0.82 0.025 30)"
  dark-pending-surface: "oklch(0.2 0.008 258)"
  dark-danger: "oklch(0.74 0.12 20)"
  dark-danger-edge: "oklch(0.66 0.14 22)"
  dark-cell-flagged: "oklch(0.68 0.18 25)"
  dark-cell-caution: "oklch(0.78 0.14 72)"
  dark-cell-failed: "oklch(0.62 0.012 260)"
  dark-cell-limited: "oklch(0.62 0.035 250)"
  dark-cell-clear: "oklch(0.6 0.01 260)"
  dark-cell-na: "oklch(0.56 0.012 260)"
  dark-cell-track: "oklch(0.27 0.01 258)"
typography:
  display:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "clamp(2.875rem, 1.5rem + 5.63vw, 5.5rem)"
    fontWeight: 600
    lineHeight: 0.98
    letterSpacing: "-0.026em"
  verdict:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "5.25rem"
    fontWeight: 600
    lineHeight: 0.95
    letterSpacing: "-0.03em"
  verdict-sm:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "3.75rem"
    fontWeight: 600
    lineHeight: 0.95
    letterSpacing: "-0.03em"
  score:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "3.75rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: '"tnum"'
  domain:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "2.75rem"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "2.5rem"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  imperative:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "1.625rem"
    fontWeight: 400
    lineHeight: 1.32
  owner:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "1.4375rem"
    fontWeight: 400
    lineHeight: 1.4
  question:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.008em"
  answer:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "1.3125rem"
    fontWeight: 400
    lineHeight: 1.5
  lead:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "1.375rem"
    fontWeight: 400
    lineHeight: 1.45
  link:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "1.6875rem"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5rem"
  meta:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: "1.375rem"
  caption:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  evidence-data:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.25rem"
    fontFeature: '"tnum"'
rounded:
  band: "0"
  cell: "2px"
  tag: "3px"
  sm: "2px"
  md: "4px"
spacing:
  column: "71rem"
  column-gutter: "16px"
  column-gutter-wide: "24px"
  form-measure: "47.5rem"
  hero-top: "52px"
  hero-top-wide: "136px"
  rail: "19rem"
  rail-gap: "48px"
  band-padding: "36px 44px 24px"
  band-padding-phone: "26px 20px 16px"
  band-rule: "5px"
  band-rule-phone: "4px"
  section: "44px"
  evidence: "56px"
components:
  button-primary:
    backgroundColor: "{colors.button}"
    textColor: "{colors.button-on}"
    rounded: "{rounded.md}"
    padding: "0 28px"
    height: "56px"
  button-primary-hover:
    backgroundColor: "{colors.button-hover}"
    textColor: "{colors.button-on}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "48px"
  button-outline-hover:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.ink}"
  button-ghost:
    textColor: "{colors.ink-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "44px"
  input-url:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "56px"
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
    rounded: "{rounded.band}"
    padding: "{spacing.band-padding}"
  verdict-band-safe:
    backgroundColor: "{colors.safe-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.verdict}"
    rounded: "{rounded.band}"
    padding: "{spacing.band-padding}"
  verdict-band-suspicious:
    backgroundColor: "{colors.suspicious-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.verdict}"
    rounded: "{rounded.band}"
    padding: "{spacing.band-padding}"
  verdict-band-malicious:
    backgroundColor: "{colors.malicious-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.verdict}"
    rounded: "{rounded.band}"
    padding: "{spacing.band-padding}"
  verdict-band-critical:
    backgroundColor: "{colors.critical-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.verdict}"
    rounded: "{rounded.band}"
    padding: "{spacing.band-padding}"
  verdict-band-unknown:
    backgroundColor: "{colors.unknown-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.verdict}"
    rounded: "{rounded.band}"
    padding: "{spacing.band-padding}"
  verdict-band-error:
    backgroundColor: "{colors.error-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.verdict}"
    rounded: "{rounded.band}"
    padding: "{spacing.band-padding}"
  strip-cell:
    backgroundColor: "{colors.cell-track}"
    rounded: "{rounded.cell}"
    height: "28px"
  strip-cell-phone:
    backgroundColor: "{colors.cell-track}"
    rounded: "{rounded.cell}"
    size: "40px x 20px"
  number-tag:
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.tag}"
    size: "20px"
  glyph-cell:
    backgroundColor: "{colors.cell-track}"
    rounded: "1.5px"
    size: "7px"
  evidence-plate:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.evidence-data}"
    rounded: "{rounded.tag}"
    padding: "14px 16px"
  history-row:
    textColor: "{colors.ink}"
    rounded: "{rounded.tag}"
    padding: "12px"
    height: "48px"
---

# Design System: Scrutinix

## Overview

**Creative North Star: "The Fact-Check"**

The link is the claim under review, and the page reports on it the way a careful fact-check does: a plain question, a rated answer, every source named. No newspaper props (no mastheads, columns, datelines, small caps, or newsprint): the editorial character lives in a sentence set well. Serif tells the story, the system sans runs the interface, and the system mono carries the link.

Light is a cool, crisp near-white ground with pure-white fields and blue-black ink. Dark is a deep cool ground with warm paper ink, designed on its own rather than inverted. Buttons are ink; one "editor's blue" accent marks only links, focus, the caret, and selection. Verdict hues appear only where a verdict is stated.

The page is one 71rem column read top to bottom as the task runs: the question "Is this link what it says it is?", one supporting line, and the scan form; then the verdict band, the link taken apart, the Evidence (the numbered strip as its index, then Summary's five questions or Full's eight rows), the actions, and local history.

Two signatures carry the identity. **The link taken apart**: the pasted link in mono at reading size, a hairline bracket naming each part, a heavy bracket on the registered domain, and one sentence stating which site it belongs to. **Citation**: the eight-cell strip heads the evidence as its index, its cells numbered 1–8, and every Summary answer cites the same numbers. The strip remains one grammar at every scale: streaming progress, evidence index, row marker, history and batch glyph, brand mark, app icon, share-image motif.

**Provenance.** Chosen on 2026-10-24 by the owner after a 16-draft bake-off judged by blind panels: base "P09 editorial (Recommended)" (`.impeccable/bakeoff/2026-10-identity-r2/editorial--opus.html`), with P11's registered-domain serif line under the verdict (`editorial--grok.html`), P09's "link taken apart" captions and numbered citations, and layer 2B's HTTPS question set. The headline is the one copy change. Built as P29.6 (layer 6 of the distinctiveness stack). Direction contract: `.impeccable/surfaces/app-page-tsx.md`.

**Key Characteristics:**

- One 71rem column; the form, history, and batch keep a 47.5rem measure; answers cap at 44rem.
- Newsreader (two static cuts) for the story; system sans for the interface; system mono for the link and data.
- A squared verdict band, the only tinted container, under a heavy top rule in the verdict's hue.
- The registered domain set in the serif directly under the verdict word.
- Ink buttons; the accent never fills a control.
- The strip carries every state by shape as well as hue; its cells are numbered and cited.
- CSS-only motion under 300ms with one authored moment: the rule draws.
- Browser surfaces are themed: selection, caret, scrollbars, focus rings, underline offset, tabular numerals.

### Motion

All motion lives in `app/scrutinix.css`, is CSS-only, and stays under 300ms. Controls ease on `cubic-bezier(0.23, 1, 0.32, 1)`; the authored moment uses an exponential ease-out, `cubic-bezier(0.16, 1, 0.3, 1)`.

- **The authored moment: the rule draws.** When a verdict lands, the band's heavy top rule (a keyed `.sx-band-rule`) draws left to right over the neutral track (`scaleX` 0 → 1, 240ms), and the verdict word rises 4px as it fades in (240ms, `@starting-style`). The band's surface cross-fades from the Checking surface (280ms).
- **Progress.** Cells fill in place as checks land (260ms `scaleX` from the left on the cell's fill layer). This is status, not a second moment.
- **Entrances.** Rows and the batch list use a 200ms fade and 4px rise; only the initial pending rows stagger (40ms each).
- **The one loop.** A still-running cell (and a batch row still checking) breathes in opacity on a 1.2s loop. Nothing else repeats.
- **Controls.** Buttons press to `scale: 0.97` over 160ms; disclosure chevrons rotate 90° over 200ms; strip cells, rows, and the question a cell leads to take a 160ms hover/target plate.
- **Reduced motion.** `prefers-reduced-motion: reduce` draws the rule and the verdict in place (no animation), and removes translation, the loop, the cell fill, the band cross-fade, chevron rotation, and button scale; entrances keep a 150ms opacity fade; smooth scrolling turns off.

## Colors

A cool, nearly achromatic system with warm paper ink by night, one blue voice for links and focus, and six verdict families that speak only when a verdict is stated. OKLCH in `app/globals.css` is the normative source; every pair below is asserted by `scripts/check-contrast.mjs` in both themes (172 pairs).

### Primary

- **Editor's Blue** (`accent`): links, the caret, and text selection's hue. Its chroma is four times Unknown slate's, so the two never read as one.
- **Focus Blue** (`focus-ring`): the same blue; every focus ring, and the edge a focused field takes.
- **Selection Wash** (`selection`): text selection behind ink.
- **Ink Button** (`button`, hover `button-hover`, label `button-on`): every filled control (Analyze at rest, Start batch, Run a fresh scan, Scan this link, Reload page, a toast's action). Light: blue-black ink with a white label; dark: warm paper with a deep label.

### Neutral

- **Cool Sheet** / **Night Ground** (`ground`): the page; also the browser `theme-color` (`#fafcfe` / `#0e1012`).
- **Field White** / **Raised Field** (`surface`): inputs, outline buttons, toasts, the skip link.
- **Plate** (`subtle`): hover plates behind rows, strip cells, and ghost buttons; the evidence plate inside an opened row; the plate behind the question a strip cell leads to.
- **Hairline** (`hairline`): every divider (header, footer, tab list, row lists, the strip's index rule, number tags). Section heads take an ink rule instead.
- **Control Edge** (`control-edge`, hover `control-edge-hover`): the 1px border on fields and outline buttons, held at 3:1 on the ground and the field.
- **Ink** (`ink`), **Muted Ink** (`ink-muted`), **Soft Ink** (`ink-soft`): primary, secondary, and quiet text (placeholders, inactive tabs, unremarkable cell names, timestamps). All keep 4.5:1 on the ground, the field, and the plate. Dark ink and muted ink are warm (hue 90): paper under a lamp, not a flipped blue-black.

### Verdict (semantic)

Each verdict owns five tokens: a graphic hue (`<v>`, 3:1 on the ground; the band's top rule and strip marks), a text hue (`<v>-fg`, 4.5:1 on the ground; history and batch verdict words, /about), a low-chroma band surface (`<v>-surface`), the hairline inside the band (`<v>-edge`, above its confidence line), and a tinted ink for secondary text on the band (`<v>-ink`: the "/100", the score band, the coverage caveat, a verified share's note). Ink, tinted ink, links, and focus all stay AA on every surface.

- **Safe Green**: a stated Safe verdict only.
- **Suspicious Amber**, **Malicious Red**, **Critical Magenta**: the three warning verdicts, stepping in hue. Malicious's rule, surface, edge, and band ink are P09's; the other hues are unchanged from the previous system.
- **Unknown Slate**: its own slate family, never the accent. Also the tone a look-alike Safe takes (band, row word, share card).
- **Error Clay**: a failed scan, desaturated so it never reads as a threat; the error boundary borrows its surface and rule.
- **Checking** (`pending-surface`; its rule is the hairline): the band while checks run, and a shared link we can't vouch for.

### Strip ramp (semantic)

`cell-flagged` (the Malicious graphic), `cell-caution` (amber), `cell-limited` (slate, a partial answer), `cell-failed`, `cell-clear`, and `cell-na` (three grays), on `cell-track`. Every mark keeps 3:1 against the ground, the track, and the hover plate.

### UI danger (semantic)

- **UI Danger** (`danger`, `danger-edge`): form errors, stream errors, an invalid field's border, and the destructive "Confirm clear". It is not a verdict colour.

### Named Rules

**The Verdict-Only Hue Rule.** Verdict hues appear only where a verdict is stated: the band's surface and rule, a history or batch row's verdict word, the share card, /about's band table. Chrome never re-tints.

**The Ink Button Rule.** Filled controls are ink. The accent marks links, focus, the caret, and selection, and nothing else.

**The Gray-Means-Nothing Rule.** A check that found nothing is a gray dash (`cell-clear`), never green.

**The Danger Is Not a Verdict Rule.** UI failures use `danger`/`danger-edge`. Never borrow `malicious-*` for a form error or a destructive confirm.

**The Tinted Secondary Rule.** Secondary text on a band uses that band's `-ink`, never a neutral gray.

**The Guarded Pair Rule.** A new token ships with its pairs added to `PAIRS` in `scripts/check-contrast.mjs`: 4.5:1 for text, 3:1 for graphics and control edges, in both themes. The unit suite fails otherwise.

## Typography

**Display Font:** Newsreader (SIL OFL 1.1), self-hosted through `next/font/local` as `--font-display` (Tailwind `font-serif`). Exactly two static latin cuts, built by `scripts/build-display-fonts.sh` from `@fontsource-variable/newsreader` 5.3.0: 400 at opsz 16 (22,708 bytes) and 600 at opsz 60 (24,156 bytes), 46,864 bytes in all, preloaded with a metric-matched Times New Roman fallback. Licence: `fonts/newsreader/OFL.txt`.
**Body Font:** the system UI sans (`system-ui`, -apple-system, Segoe UI).
**Label/Mono Font:** the system mono (`ui-monospace`, SF Mono, Cascadia Mono, Menlo, Consolas).

**Character:** the serif is the reporter: it states the question, the verdict, the site, the instruction, and each answer. The sans is the instrument panel: tabs, buttons, captions, sources, rows. The mono is the evidence: the link and data, always tabular.

### Hierarchy

- **Display** (600, 46–88px fluid, 0.98, −0.026em): the home headline. Public-page titles use a smaller fluid step (40–68px).
- **Verdict** (600, 84px from 48rem, 60px below; 0.95; −0.03em): the verdict word, the largest type on any result. It never outgrows its band: the size is `clamp(2rem, 16.4cqi, size)` against the band frame (an inline-size container), so the longest word ("Unconfirmed") fits a 320px phone at about 38px while wider bands keep the full size. A larger default text size never makes it smaller, at any width: the band's width can't shrink as text grows (the column's gutters and the band's side padding are px), the floor and both caps are rem, and the full size switches on at 768px, a px width (48rem at the default size), so a larger text size can't switch it back to the phone cap. Where the larger word can't fit, it wraps, at a hyphenation point when there is one.
- **Score** (600, 60px / 40px, tabular): the threat score numeral; "/100" beside it in the serif at 22px in the band's ink.
- **Domain** (600, 44px / 30px, −0.02em): the registered domain under the verdict word.
- **Headline** (600, 40px / 32px): "Check another link"; an unverified share's band heading.
- **Title** (600, 28px / 22px): Evidence, History, Batch results, public-page sections.
- **Imperative** (400, 26px / 22px, 1.32): the one instruction in the band.
- **Owner** (400, 23px / 20px): "This link belongs to secure-login.xyz, not paypal.com.", domains in mono at 0.86em, the owner bold.
- **Question** (600, 22px / 20px) and **Answer** (400, 21px / 18px, 1.5): Summary.
- **Lead** (400, 22px / 18px, 1.45): the supporting line under a headline, in Muted Ink.
- **Link** (mono 400, 27px / 19px on a result; 22px / 17px under the form): the link taken apart.
- **Body** (16px, 24px): interface sentences, buttons, tabs, Full findings, public prose (at 32rem: 65–75 characters per line).
- **Meta** (15px): nav, captions under the link, sources lines, cell names (14px on phones), the legend.
- **Caption** (13px): timestamps and mono evidence entries.

### Named Rules

**The One Display Moment Rule.** Once the verdict band mounts, the home headline steps out of sight (it stays the page's h1) and the supporting line goes, so the verdict is the only display size on screen. It happens when the scan starts, never after the verdict lands.

**The Mono Is Data Rule.** Mono sets the link, domains inside sentences, evidence entries, counts, and timestamps, always tabular. The registered domain under the verdict is the sentence's subject, so it is the serif, not mono.

**The Two Cuts Rule.** The page loads exactly the two Newsreader cuts. A third weight, an italic, or another face needs the owner and a raised `bundleBudget.fontBytes` (48,000 today).

**The Taught Scale Rule.** Every custom `text-*` step lives in `@theme` and is registered with tailwind-merge in `lib/utils.ts`.

## Layout

One centred column, `max-width: 71rem`, with 16px gutters (24px from 40rem), in px (`.sx-gutter`) so a larger default text size gives the words the room, not the margins. Anything that bleeds into the gutter (row hover plates, a ghost button's hit area, the header's links, the phone strip's cells) bleeds in px too, so it never outgrows it. The header (72px; 60px on phones) and the footer share it, each set off by one hairline. The home opens 136px below the header (52px on phones): the headline (max 57.5rem, two lines at desktop), the supporting line 28px below (max 37.5rem), and the form 56px below at a 47.5rem measure, so the tabs, the 56px field, Paste, and the ink Analyze button sit in the first viewport on desktop and phone.

With a result on the page the column starts 28px under the header (8px on phones) and the results take the full column: the band 28px under the form, "The link, taken apart" 44px below, Evidence 56px below, then "How we reached this verdict" and the actions. On phones the field and Analyze share one row once a result shows (Paste steps aside) so the verdict lands in the first view; the actions become Download on its own row with Share and Re-scan halves. History follows at the form's measure, 96px below, and draws nothing when empty.

**Shared-view order (recipient-first).** A shared link opens on the results stack (band, the link taken apart, and the strip when verified), then "Check another link" at Headline size with the supporting line and the form, 80px later. The hero headline is not drawn (an `sr-only` h1 "A link shared with you" keeps the outline). A fresh scan replaces the band in place. Nothing takes focus on arrival, and neither shared state speaks through the live region on load. A `/?url=` link opens the ordinary order with the link in the field, taken apart below it, and Analyze focused (not the field, so a phone keyboard never covers it). A share with no link to fill in (`/?nolink=1`) opens the ordinary order, empty, with one line 12px under the form in Meta size and Muted Ink, never danger colour: "We didn't find a link to check in what you shared." It takes no focus and has nothing to tap, and it goes for good once the visitor types or pastes in either tab, scans, or taps Analyze on an empty field (whose own error then says it).

**Public pages** (`/about`, `/privacy`) use the same column and header: a serif title, the serif lead, one hairline, then sections 64px apart at the prose measure (32rem) or the list measure (48rem). Plain `<table>`, `<details>`, and `<code>` inside the shell are styled by `.sx-public` (zero-specificity `:where()`): an ink header rule over hairline rows, tabular figures, `data-numeric` cells right-aligned, disclosure summaries with a drawn chevron. `TableFrame` wraps a wide table so it scrolls on its own (focusable region) instead of widening a phone.

Responsive behaviour: the band's score (or what takes its place) moves from its right column (from 48rem) to a baseline row under the instruction, and a band with nothing there gives its word and instruction the full width; the strip is two columns of four rows below 40rem (one column of eight below 20rem, so only at a larger text size), a 4 × 2 grid to 64rem, a single row of eight from 64rem; the question rail starts at 64rem; the link's parts stack below 40rem. The page scrolls as one document; `scrollbar-gutter: stable` keeps the column still as results grow. A larger default text size reflows instead of scrolling sideways: the header's nav, the footer's links, the Evidence switch, and Batch's "up to 10 links" hint wrap onto their own line when they don't fit; a button's label wraps inside it rather than outgrowing the column; check names wrap on phones (breaking inside a word only when one alone is wider than the line); a check's details stack (label over value) and the strip goes to one column below 20rem, a rem media query that follows the reader's text size (under 480px at 150%, 640px at 200%) and never applies at the default size from 320px; and any word wider than its line breaks (`overflow-wrap: break-word` on the body), which changes nothing that fits. The row verdict column is at least 7rem and grows only when a wide system font needs it for "Unconfirmed". The e2e suite holds all of this at 150% and 200% from 320px, on desktop and phone emulation; CI runs it on Linux, whose default sans (DejaVu) is wider than the macOS and Android fonts, so the layout is checked with a wide font as well as a narrow one.

### Named Rules

**The No-Reflow Rule.** Streaming never moves what is above the strip, and a verdict landing moves nothing above the actions, at any width. Cells fill in place; from "Checking" on, the band holds the room its tallest verdict takes (below), and the domain line while the parser loads; the anatomy draws no facts the Evidence states, so nothing under the band collapses; the strip's key is drawn whole from the scan's start; Cancel lives inside the Checking band, in the score's place. `tests/e2e/landing.fixture.spec.ts` holds every fixture verdict to zero band growth and unchanged positions at every frame of the landing at 375px, 768px, and 1280px in every engine, and to zero recorded layout shift in Chromium (the only engine that records it). Three changes stay by design: a failed scan trades its five questions for its eight rows (it has nothing to answer them with), a coverage caveat adds its lines to the band (a 40px line at 1280px; often nothing on a phone, where it fits the room a verdict leaves; the same e2e file pins that it moves nothing else), and a link parser that loads only after the verdict redraws the link's breakdown under the band.

## Elevation & Depth

Flat by default. Depth comes from type scale, spacing, rules, and one tonal device: the band's low-chroma surface under its heavy rule. Section heads (Evidence, History, Batch) sit on a 1px ink rule; lists divide on hairlines. Hover is a Plate, not a lift. Focus is a 2px Focus Blue outline offset 2px (fields take it flush on their own edge). Toasts are the one floating surface: a control-edge border and a short offset shadow. No gradients, glass, or glows.

### Named Rules

**The One Tinted Surface Rule.** The verdict band is the only tinted container on a result. The error boundary reuses its shape on the Error surface. Everything else is type on the ground, divided by rules.

## Shapes

Squared and exact. The band and the error boundary have no radius. Controls use 4px; plates, number tags, and hover plates 3px; strip cells 2px; glyph cells 1.5px. Borders are 1px (hairlines for structure, Control Edge for fields and outline buttons, ink under section heads); the band's rule is 5px (4px on phones). Tabs and the Summary/Full switch mark selection with a 2px ink underline, never a pill. The link's brackets are 1px soft ink with 6px end ticks; the registered domain's is 2px ink with 7px ticks.

The brand mark is the strip folded 4 × 2 (six-unit cells, two-unit gaps, one-unit radius) from `lib/brand-mark.ts`, drawn in ink beside the serif wordmark and on share cards, and on a 22%-rounded ink tile for app icons. The mark's colours did not change in this layer, so the icons were not regenerated.

### Named Rules

**The Shape Before Hue Rule.** No two strip states differ by colour alone: flagged is a solid block, caution a −45° hatch, found-nothing a short centred dash (half the cell's width), a partial answer a centred short block (never a length that reads as progress), failed a 1.5px inset outline, didn't-apply a dashed outline, and still-running the bare track. Under forced colours the cells redraw the same shapes in system colours, and the band keeps its rule as a border. The hatch is the only repeating-gradient pattern and lives only inside cells.

## Components

### Buttons

- **Shape:** 4px radius, 1px border, 44px minimum target; body type at 500 (600 on ink).
- **Primary (ink):** Analyze is 56px tall beside the field (52px stacked on phones), never disabled at rest; while a scan runs it is `aria-disabled`, not disabled, so focus stays. While a result is on screen it drops to the outline style; editing the field restores it.
- **Outline:** Field White, Control Edge border, ink label, 48px; hover darkens the edge and lays a Plate. Result actions: Download result (JSON), Share, Re-scan.
- **Ghost:** no fill, Muted Ink; hover lays a Plate and inks the label. Paste, exports, Clear/Undo, Cancel scan, batch Open.
- **Press:** `scale: 0.97` over 160ms.

### Inputs / Fields

Field White, 1px Control Edge, 4px radius, 16px padding. The URL field is 56px (52px on phones; 48px in the result row) in mono at body size, placeholder "Paste a link" in Soft Ink. Focus turns the border Focus Blue with the outline flush on it; errors turn it UI Danger with a plain danger line beneath (`role="alert"`).

### Tabs (Single / Batch) and the Summary/Full switch

Text triggers on a baseline rule, 44px tall, at least 44px wide, 30px apart. Inactive is Soft Ink; active is ink with a 2px ink underline. Batch carries an "up to 10 links" hint outside its accessible name. Summary/Full is one `role="switch"` with the same look, set on the Evidence head's ink rule. It is drawn only when both views exist: an Error result has only its eight rows, so it has no switch (a control never claims a view that isn't shown), and the head keeps the switch's 44px so the rule stays put; the choice carries to the next result.

### Navigation

Header: the mark and the serif wordmark (600, 23px / 21px), then About, Privacy (meta, Muted Ink to ink, ink when current), and the theme toggle, all 44px. Footer: one line on a hairline: the serif wordmark, About, Privacy, Source, and "Free and open source. No account needed."

### Verdict band (signature)

A column-wide `section` on `<verdict>-surface`, squared, under its rule (`--sx-<verdict>`) drawn over the neutral track; padding 36px 44px 24px (26px 20px 16px on phones; the side padding is px, like the gutters). Inside: the verdict word at Verdict size in ink (`h2#sx-verdict-heading`, focusable), the registered domain under it at Domain size in the serif (it names the site only; the anatomy carries the sentence), the imperative beneath in the serif, and on the right the score with "/100" and its band ("Malicious band 55–79") in the band's ink, only when `getVerdictGuidance().showScore`. Below, set off by the band's hairline: the confidence label in ink 600 with "How scoring works" (a look-alike's note "No check flagged it, but the name is misleading." is regular weight); a "because" sentence only when no evidence shows beneath (a legacy record); a coverage caveat in band ink when coverage was limited. While checks run the same tree reads "Checking" in Soft Ink on the Checking surface with the domain, "3 of 8 checks finished", and Cancel scan, so focus survives. A scan's band (Checking, the address check, and the verdict it lands as) is one height whatever lands: it holds the room of the tallest band with something in the score's place (its longest word and instruction beside a score, Cancel, or Try again, then a confidence label) and of the tallest without (its longest word and instruction across the band, then the longest note), each the band's own layout drawn invisibly over it with generated stand-ins (`bandSays` in `verdict-guidance.ts`), so the room follows the reader's text size and the column's width rather than a fixed height. It holds only verdicts that can still land: once the link's address check is ready, a link that spells out no other site holds no room for "Look-alike" or "Unconfirmed" and their notes. The site's line holds the registered domain, or the link's whole host while the parser that finds the domain loads (the domain, a suffix of the host, never outgrows it). That is decided when the scan starts and never narrows before the next one, so a check that settles mid-scan never shrinks the band, and a long domain the parser finds late moves nothing. The word, the site, the instruction, and the score's place sit together at the top (below 48rem, where a larger text size can wrap one word onto two lines and not another, the word's slot holds the tallest word the band can show, a shorter one sitting at its foot, on the site); the confidence line sits at the band's foot, so the room a shorter verdict leaves opens above the hairline (Unknown keeps the most; a failed scan, like Checking, has no last line, so its room opens at the foot). The score's column keeps its width in every state, so the instruction wraps the same way whatever lands. A failed scan has no score or confidence to state: the score's place holds "Try again", the band's ink button, where Cancel scan stood while it ran; it scans the link again. A look-alike Safe reads "Look-alike", takes the Unknown family, and shows no score. A **verified** shared snapshot shows its verdict, the imperative the sender's band showed (worded from the signed `basis` by `getSharedGuidance`; a snapshot signed before the basis existed keeps the hedged forms, and where the sender's link parser failed, "Unconfirmed", the recipient's instruction comes from Scrutinix's own address check), its summary unless it only repeats the instruction ("No check flagged this link." under "Looks safe to open." is left out, as on the sender's band), the ink "Run a fresh scan", and "Verified Scrutinix result · checked <UTC date and time>. It may be out of date." on the band's hairline; past 3 days it becomes the unverified band with "This shared result is more than 3 days old, so we're not showing it." An **unverified** link takes the Checking surface and track, the heading "Check this shared link yourself" at Headline size (never Verdict size, never a verdict word), the domain line (Scrutinix's own computation), one plain sentence, and "Scan this link"; nothing from the payload is drawn. Every verdict string comes from `lib/domain/verdict-guidance.ts` and `lib/domain/verdict.ts`. A Safe result waits for the link parser: until it loads the band keeps the Checking tree ("Checking", "Checking the link's address", the site's line holding the host) in the room it held while checking, so neither "Safe" nor green shows before a look-alike is ruled out; if the parser fails it reads "Unconfirmed" on the Unknown surface, no score, "Check the link's address before you open it.", and "We couldn't check whether this address imitates another site." in place of the confidence line.

### The link, taken apart (signature)

On a result, under a quiet rail heading ("The link, taken apart", body 600, Muted Ink, a plain block so the pasted link's region keeps that name alone), and under the form before a scan (a region with that name): the link in mono, scheme and path in Soft Ink, subdomain in Muted Ink, the registered domain bold in ink. Each named part stands over a hairline bracket carrying its caption in meta type ("A label anyone can add", "Registered domain", "A page on that domain", "Ignored by browsers" for a login name, struck through); the registered domain's bracket is heavy and its caption ink 600. A caption never widens its part (`contain: inline-size`, min 5.5rem), so the link stays one line of text. Nothing follows the last part, so its caption may run past its text to the end of the line, and wraps there rather than past the column (the part fills the rest of its line; its bracket is drawn under the text). Below 40rem the parts stack, each on a 1px left rule (3px ink for the domain), captions beneath, and the bare scheme steps out of sight (still spoken). Assistive technology hears each part after its caption; the visual captions are `aria-hidden`. A long path truncates with "Show full link". A look-alike gets one Owner sentence. Beneath, a small two-column list keys facts to the part they describe, only where no evidence states them: a result's Evidence states all eight checks, so the result's breakdown draws none, while a scan runs or after. History and batch rows use the compact single line: the subdomain truncates from its left, the owner never.

### Evidence: the strip as the index (signature)

Evidence is a serif Title over an ink rule with the Summary/Full switch at its right (none on an Error result, which has only its rows; its place is held, since at a larger text size the switch wraps under the title). Under it, the live strip as the index (`role="toolbar"` "Checks", roving tabindex): each cell a named control ("Redirects: …") with its bar, its number in a hairline tag (`.sx-tag`, 1–8 in `signalNames` order), and its short name (ink 500 when flagged, caution, or failed; Soft Ink otherwise, underlined on hover). It moves focus to the question citing its check (Summary; that question takes a Plate) or opens and focuses its row (Full); on an Error result, whose rows hold no evidence, it focuses the row, and the strip's hint says "Each check moves to its row below." Left/Right step through the cells and wrap; Up/Down move a row (clamped) from 40rem and step in order down the phone's two columns. A key under it names every state a settled strip can draw ("Flagged the link", "Found a warning sign", "Gave a partial answer", "Found nothing", "Couldn't run", "Didn't apply"), hidden from assistive technology. It is the whole key from the scan's start, so it explains the cells as they fill and never changes as checks or the verdict land. A hairline closes the index. Shared snapshots draw the same grid settled, as a list with real text per state.

### Summary questions (on a rail)

Five questions in fixed order (layer 2B's set: Has it been reported? · Where would it take me? · What else raises concern? · Does HTTPS make it safe? · What did the other checks find?) on hairlines. From 64rem each question (Question type, `h4`, focusable) and its "From" line hang in a 19rem rail with the answer and why clause beside it at Answer size (44rem cap), the why in Muted Ink, any disagreement sentence after it. Narrower they stack: question, answer, then "From". The "From" line cites the strip: "From [1] VirusTotal · [3] Safe Browsing · [4] Threat feeds" with the same number tags; assistive technology hears "Sources: VirusTotal, Safe Browsing, Threat feeds" instead (one `QuestionSources` component), and the numbered line can't be selected, so a copy gives that plain list. No severity colour or marker here: the strip and Full rows carry each check's severity once. A pending question shows "Checking…" in Soft Ink over the room a typical answer takes (a representative answer and why drawn as invisible generated content, never text), so the headings below hold their place for clean answers; a longer answer (a flagged report with a disagreement, a long host) can still grow. Answer text wraps anywhere, so a long hostname breaks instead of widening a phone.

### Full rows

The eight rows on the same rail and hairlines: the row marker (a 24 × 14 cell), the number tag and the signal label (body 500, ink) in the rail column, the finding in Muted Ink beside it (wraps, never truncates), and a chevron when evidence exists. Opening a row reveals the evidence plate (mono key/value, timing only there) aligned under the finding. Rows are also an Error result's Summary.

### History and batch

At the form's measure, under a serif Title on an ink rule. One row grammar (`result-row.tsx`): the glyph, the verdict word in its `-fg` colour at body 600 (a look-alike Safe reads "Look-alike" in Unknown slate; a Safe row holds "—" until the link parser loads, and reads "Unconfirmed" in Unknown slate if it failed), the compact anatomy, and a timestamp (history) or Open (batch). Rows are 48px minimum; history rows are whole-row buttons with a Plate on hover. A filter appears past three entries; clearing confirms in UI Danger and offers Undo. Batch shows a mono "3/10" count and an index column from 40rem.

### Share images

1200 × 630 cards from `lib/og/cards.tsx` in the light theme: Newsreader (the same two cuts, as TTF) for the wordmark, headline, supporting line, verdict, instruction, and the registered domain; Geist for interface text and Geist Mono for domains inside a look-alike's sentence (a server can't embed the system faces). Colours are the light tokens' hex equivalents. The default card: mark and serif wordmark, the home headline in explicit lines broken where the question pauses ("Is this link / what it says it is?"; the page balances its `<h1>` by width and can break after "what", and neither is changed to match the other), the supporting line, the ink strip, "scrutinix.net". A result card: the squared band under its 8px rule (word at 104px, instruction at 38px; a Safe look-alike's word is "Look-alike", never "Safe"), the registered domain in the serif (or the ownership sentence for a look-alike), and the result's strip with names, shapes mirrored. Only a signed payload within 3 days gets a result card. The registered domain always keeps one line (`lib/og/card-layout.ts`, measured from the fonts' own advance widths): 48px when it fits, else the largest whole size down to 32px that fits (a 63-letter label and `.com` fits whole at 32px), and past that an ellipsis in the middle of its label, so its start, the end of its label, and its whole suffix always show. A look-alike's sentence stays one line when it fits and otherwise breaks at its comma ("This link belongs to <owner>," / "not <brand>."), each domain fitted the same way in mono (down to 24px; the imitated site is never set larger than the owner; a decoded login name in a script Geist Mono lacks, such as `支付宝.com`, is measured at 1.2em a letter and shortened only between whole letters), and every run sits on one baseline (Satori aligns boxes, not baselines, so each run gets the line box that lands it there).

### Accessibility contract (tests depend on these)

- Landmarks and targets: skip link to `#main-content`; `id="scan-console"`; band `section` named "Scan result: {verdict}" (or "Scanning URL", "Shared link, not verified", "Shared result, expired"); focusable `h2#sx-verdict-heading`; region "The link, taken apart" for the pasted link only; region "Scan history" with heading "History (N scans)" and filter `#sx-history-filter`; region "Batch scan results".
- Names: textboxes "URL to analyze" / "URLs to analyze, one per line"; buttons Analyze URL, Start batch, Clear all history, Confirm clear all history, Undo clear history, Run a fresh scan, Scan this link, "Open result for {link}"; `role="meter"` "Threat score" (`aria-valuetext` "73 out of 100"); `role="switch"` whose name starts with its visible labels ("Summary Full signal list"); toolbar "Checks"; list "Questions" with an `h4` per question; list "Signals"; each row named "{Label}: {finding}", its visible text in order. Cell numbers and the "From" line's tags are `aria-hidden`; names stay the source of truth.
- Announcements: one polite live region, never remounted, reports progress and `getVerdictAnnouncement` on completion, waiting for the link parser so a look-alike is spoken with its hedge (or, if it failed, an "Unconfirmed" Safe with why). The no-link note (`components/scrutinix/no-link-note.tsx`) has its own `role="status"` region, drawn empty by the server and filled once about 500ms after load, so the arrival is spoken once and politely; its visible line is `aria-hidden` so it is never read twice.
- Focus: a `/?url=` prefill (a share-target launch redirects to one) focuses Analyze, not the field, so a phone keyboard never covers the link taken apart below it; Re-scan and the shared-scan buttons park focus on the band heading; Cancel returns it to the field; a strip cell focuses its question or opens and focuses its row.
- Floors: 44px targets; colour never carries meaning alone; coloured text uses `-fg` or `-ink` tokens; axe at zero on the empty page, a pasted link, results, shared links, and /about in both themes; Lighthouse Performance ≥ 0.90, Accessibility ≥ 0.95.

## Do's and Don'ts

### Do:

- **Do** keep the order headline → form → band → the link taken apart → Evidence (strip index, then questions or rows) → actions → history.
- **Do** state each fact once: one score, one severity per signal, the owner sentence once (the band only names the domain).
- **Do** set the story in Newsreader and the interface in the system sans; keep mono for the link and data.
- **Do** cite checks by the strip's numbers, with names alongside and names alone for assistive technology.
- **Do** draw every new strip state with its own shape and add its pair to the contrast guard.
- **Do** design light and dark separately and check both at every change.
- **Do** keep static component layout in `app/scrutinix.css` (`.sx-*`) when it would otherwise grow the first-load script.

### Don't:

- **Don't** use newspaper costume: mastheads, columns, datelines, small caps, drop caps, rules as ornament, newsprint textures.
- **Don't** use casefile/dossier/stamp costume, terminal/CRT/radar/glow theater, or cream-and-purple SaaS.
- **Don't** fill a button with the accent, or use the accent for anything but links, focus, the caret, and selection.
- **Don't** round the band or add a second tinted container; errors are plain lines of text.
- **Don't** add score rings, gauges, threat-level bars, or stacked per-signal badges.
- **Don't** colour a found-nothing check green, or a UI error with a verdict red.
- **Don't** load a third font cut or face, or synthesize bold/italic from the two (`font-synthesis: none`).
- **Don't** add taglines, kickers, stat bands, or feature grids around the one headline.
- **Don't** say "independent" for the checks (they are separate) or "who owns it" for a site (it is which site the link belongs to).
