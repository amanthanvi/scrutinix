# DESIGN.md — Scrutinix Instrument Casefile

**Register:** Product (tool UI).  
**Lane:** Instrument Casefile — cool steel forensic ledger, not CRT terminal.

## Surfaces

| Route      | Role                                            |
| ---------- | ----------------------------------------------- |
| `/`        | Scanner-first intake + evidence workspace       |
| `/about`   | Method dossier (folio masthead + exhibit index) |
| `/privacy` | Privacy dossier (same materials)                |

## Materials

- Tokens: `app/globals.css` (`--sx-*` cool steel neutrals + verdict semantics)
- Effects: `app/scrutinix.css` (folio stamp, ledger, verdict stamp, dial, severity top rails)
- No footer marquee; quiet static status line only
- No radar / scan-line / accent-glow identity

## Type

- Geist Sans for UI; Hack for folio stamps, tabs, tabular data
- Product scale (fixed rem steps); display tracking ≥ −0.03em on brand wordmark

## Motion

State-only, 150–250ms, `prefers-reduced-motion` honored. No page-load stage theater on docs.

For the home shape brief and kill list, see `DESIGN-HOME-SHAPE.md`.
