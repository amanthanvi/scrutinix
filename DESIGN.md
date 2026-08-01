# DESIGN.md — Scrutinix (Minimal Product Tool)

**Register:** Product (tool UI).
**Status:** Live — documented from the built system (2026-07 redesign; supersedes Daylight Desk).
**Direction provenance:** user-pinned canon (minimal product tool at Linear/Vercel craft level) via explicit choice; no concept-seed roll was run for this world.

## Thesis

The verdict is a sentence with a number, not a dashboard. One centered column, achromatic surfaces, one blue accent, and verdict color only where a verdict is stated. Every fact renders exactly once.

## Surfaces

| Route      | Role                                                                     |
| ---------- | ------------------------------------------------------------------------ |
| `/`        | Title → scan form → verdict panel → 8 signal rows → history, in one flow |
| `/about`   | Method / trust (same 44rem shell, plain prose)                           |
| `/privacy` | Privacy boundaries (same shell)                                          |

## Visual system

- **Layout:** single centered column, `max-w-[44rem]`; h-14 header; one-line footer. The page scrolls — no sticky rails, no scroll areas.
- **Color:** achromatic neutrals (OKLCH, zero chroma in light; near-zero cool tint in dark). One static accent blue (`--sx-accent`) for the primary action, links, focus, and the live indicator. Five verdict hues, each as a pair: `--sx-<verdict>` for graphics (dots, bars) and `--sx-<verdict>-fg` for AA text on the theme background. No dynamic accent — chrome never re-tints.
- **Theme:** system default (`next-themes`); light and dark are both designed, neither derived.
- **Depth:** flat backgrounds and 1px borders only — no shadows, gradients, washes, or blur.
- **Type:** Geist Sans for UI; Geist Mono for data (URLs, scores, durations, detail entries). 13px UI / 14px body / 16px section / 20px page title / 24px verdict word. No uppercase display type.
- **Radius:** 6px (`--radius: 0.375rem`).

## Component grammar

- **Verdict panel:** verdict word (colored `-fg`) + `role="meter"` score + confidence as text; mono URL; summary sentence; one merged amber caveat sentence; plain reason list; native `<details>` for recommendations, caveats, and scan metadata.
- **Signal rows:** eight stable `<details>` rows, fixed order, filled in place. One severity encoding: a 6px dot. Evidence is a mono `<dl>` from `getSignalDetailEntries`.
- **History:** in-flow list — verdict word, mono URL, time. Search filters URL, verdict, and summary. Confirm-clear with undo; exports as quiet text buttons.
- **Batch:** plain list — index, verdict word, mono URL, Open.

## Motion (CSS-only, Emil Kowalski rules)

- `--sx-ease: cubic-bezier(0.23, 1, 0.32, 1)`; everything <300ms; transform/opacity only.
- `sx-enter`: 200ms `@starting-style` fade/rise on panels and rows; 40ms stagger on the initial pending fill only.
- `sx-progress`: 2px transform-only `scaleX` fill. `sx-live`: the app's single infinite animation (streaming dot).
- Buttons: `:active` scale 0.97 @160ms. Disclosure chevrons rotate 200ms. No animation on tab switches or input focus. `prefers-reduced-motion` collapses movement, keeps opacity.

## Ban list

No CRT/terminal/radar/glow. No casefile/dossier/stamp costume. No cream/purple SaaS. No score rings, threat bars, or duplicate encodings of the same number. No card stacks or per-item bordered boxes inside a panel.

## Accessibility contracts (tests depend on these)

`role="meter"` "Threat score" (post-scan), region "Scan history", per-signal `aria-label="{Label} signal: {status}"`, textbox names "URL to analyze"/"URLs to analyze", buttons Analyze / Start batch / Clear all history / Confirm clear all history / Undo clear, skip link, `id="scan-console"`, `id="main-content"`. Axe runs at zero violations; colored text always uses `-fg` tokens.
