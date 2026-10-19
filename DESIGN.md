# DESIGN.md — Scrutinix (Minimal Product Tool)

**Register:** Product (tool UI).
**Status:** Live — documented from the built system (2026-07 redesign; supersedes Daylight Desk).
**Direction provenance:** user-pinned canon (minimal product tool at Linear/Vercel craft level) via explicit choice; no concept-seed roll was run for this world.

## Thesis

The verdict is a sentence with a number, not a dashboard. One centered column, achromatic surfaces, one blue accent, and verdict color only where a verdict is stated. Every fact renders exactly once.

## Surfaces

| Route      | Role                                                                                |
| ---------- | ----------------------------------------------------------------------------------- |
| `/`        | Title → scan form → verdict panel → Summary/Full signal rows → history, in one flow |
| `/about`   | Method / trust (same 44rem shell, plain prose)                                      |
| `/privacy` | Privacy boundaries (same shell)                                                     |

## Visual system

- **Layout:** single centered column, `max-w-[44rem]`; h-14 header; one-line footer. The page scrolls — no sticky rails, no scroll areas.
- **Color:** achromatic neutrals (OKLCH, zero chroma in light; near-zero cool tint in dark). One static accent blue (`--sx-accent`) for the primary action, links, focus, and the live indicator. Six verdict hues, each as a pair: `--sx-<verdict>` for graphics (dots, bars) and `--sx-<verdict>-fg` for AA text on the theme background; Unknown uses its own slate pair (`--sx-unknown` / `--sx-unknown-fg`), never the accent hue. A per-signal finding of "nothing found" is `clear`, drawn in neutral gray (`--sx-clear`, graphic only) — green is reserved for a stated Safe verdict, so a clean source never reads as "this source says the link is fine" next to a Malicious verdict. Caveated checks use the slate `--sx-unknown` dot. No dynamic accent — chrome never re-tints.
- **Theme:** system default (`next-themes`); light and dark are both designed, neither derived.
- **Depth:** flat background; structure comes from typography, spacing, and hairline dividers (`border-y` + `divide-y`). Borders are reserved for controls (inputs, buttons). No cards, shadows, gradients, washes, or blur.
- **Type:** Geist Sans for UI; Geist Mono for data (URLs, scores, durations, detail entries). 13px UI / 14px body / 16px section / 20px page title / 24px verdict word. No uppercase display type.
- **Radius:** 6px (`--radius: 0.375rem`).

## Component grammar

- **Verdict:** a typographic block, not a card — verdict word (colored `-fg`, focusable `h2#sx-verdict-heading`) with, beside it, the `role="meter"` score, its band ("Malicious band 55–79"), confidence as text, and a "How scoring works" link to `/about#scoring`. Unknown and Error show no score (`getVerdictGuidance().showScore`). Directly under the verdict word, one imperative line (`text-base font-medium`) tells the person what to do. Critical says "— it's a known threat" only when a reputation source confirmed it (`hasConfirmedReputationHit`); heuristic-only Critical gets the plain "Don't open this link." Then the mono URL; one summary sentence naming the evidence ("7 VirusTotal engines and URLhaus flagged this link."); one amber caveat naming the checks that limited coverage, only when one did (`getCoverageCaveat`); then the driver rows. A clean, fully covered Safe hides its summary (`shouldShowVerdictSummary`) because the quiet-checks line already says it. The reason list is not repeated in view: native `<details>` holds "What we found" (reasons), "What to do", "Caveats" (only real limitations), "Why {level} confidence", and scan metadata (13px semibold sub-headings). Shared snapshots show the same imperative line (hedged, with no score). All verdict copy comes from `lib/domain/verdict-guidance.ts` and `lib/domain/verdict.ts`; components never compose it.
- **Signal rows:** an accessible Summary/Full switch. Summary lists only the signals that drove the verdict — every check the engine scored against the link (`threatInfo.scoredSignals`, so redirect, page-content, and domain-age evidence always shows), plus any malicious, suspicious, or failed severity, in fixed order — and folds every other check into one plain line ("6 other checks found nothing." / "All 8 checks found nothing.") that also switches to Full; a clean scan therefore shows no rows. Full lists all eight in fixed order. Rows are a `<ul>` of `<li>` in a hairline table (`border-y` + `divide-y`) with one severity encoding, a 6px dot (a scored check never shows the gray "clear" dot); finding text wraps rather than truncating, and the label stacks above it on narrow screens. Evidence is a mono `<dl>` from `getSignalDetailEntries`; per-row timing lives only there. Findings are plain sentences ("The site didn't accept a secure connection.", "Registered about 8 years ago."); provider wording stays under Notes, and API enums never reach the finding (Google's `SOCIAL_ENGINEERING` reads "phishing or a deceptive site"). A feed that lists a different link on the same host never reads as listing this one ("No listing for this link; OpenPhish lists other links on this site.").
- **Result actions:** Download result (JSON) / Share / Re-scan sit after the signal rows, never between the verdict and its evidence. Every export button names its scope (result, batch, history).
- **Analyze:** never disabled at rest — an empty submit shows an inline "Paste a link to check." While a result is on screen it drops to the outline variant so the verdict owns the color; editing the input restores the primary style.
- **Tabs:** text tabs with a 2px accent underline on the active trigger (Radix) — no pill container. The Summary/Full switch uses the same text-option look.
- **History:** hairline-divided in-flow list — verdict word, mono URL, time — with one entry per normalized URL (a new scan replaces the older one). Search filters URL, verdict, and summary. Confirm-clear with undo; exports as quiet text buttons. "History stays on this device" is said once, in the footer.
- **Batch:** hairline-divided list — index, verdict word, mono URL, Open.
- **Errors / empty states:** plain colored or muted text lines — never callout boxes; absence is the empty state.

## Motion (CSS-only, Emil Kowalski rules)

- `--sx-ease: cubic-bezier(0.23, 1, 0.32, 1)`; everything <300ms; transform/opacity only.
- `sx-enter`: 200ms `@starting-style` fade/rise on panels and rows; 40ms stagger on the initial pending fill only.
- `sx-progress`: 2px transform-only `scaleX` fill. `sx-live`: the app's single infinite animation (streaming dot).
- Buttons: `:active` scale 0.97 @160ms. Disclosure chevrons rotate 200ms. No animation on tab switches or input focus. `prefers-reduced-motion` collapses movement, keeps opacity.

## Ban list

No CRT/terminal/radar/glow. No casefile/dossier/stamp costume. No cream/purple SaaS. No score rings, threat bars, or duplicate encodings of the same number. No cards: no enclosing `rounded border bg` containers around content, no callout boxes, no pill tab bars. No marketing headlines on the tool surface.

## Accessibility contracts (tests depend on these)

`role="meter"` "Threat score" (scored verdicts only), `role="switch"` whose name starts with its visible labels ("Summary Full signal list", WCAG 2.5.3), region "Scan history" with heading "History (N scans)" and filter `#sx-history-filter`, per-signal `aria-label="{Label} signal: {finding sentence}"` on each row's `<summary>` (or its `<li>` when it has no evidence), textbox names "URL to analyze"/"URLs to analyze", buttons Analyze URL / Start batch / Clear all history / Confirm clear all history / Undo clear, skip link, `id="scan-console"`, `id="main-content"`. The polite live region reports progress while streaming ("3 of 8 checks finished.") and `getVerdictAnnouncement` on completion ("Result for evil.example: Malicious, 73 out of 100. Don't open this link."). Opening a history entry or a batch row moves focus to `#sx-verdict-heading` and blanks the region for 100ms before refilling it, so reopening a result with identical text is still spoken; the region itself never remounts. Revealing the quiet checks moves focus to the first revealed row (the `Signals` list is the `tabIndex=-1` fallback). Axe runs at zero violations on the empty page and on a result; colored text always uses `-fg` tokens.
