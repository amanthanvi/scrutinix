# DESIGN.md — Scrutinix (Daylight Desk)

**Register:** Product (tool UI).  
**Status:** Crafted — **Daylight Desk** live on public surfaces (`DESIGN-HOME-SHAPE.md`).

## Source of truth

| Doc                         | Role                                                |
| --------------------------- | --------------------------------------------------- |
| `DESIGN-REDIRECTION.md`     | Grill locks (scene, IA, keep/kill, anti-references) |
| `DESIGN-HOME-SHAPE.md`      | Shape brief for home + public docs                  |
| `PRODUCT.md` / `CONTEXT.md` | Product register + vocabulary                       |

## Surfaces (jobs)

| Route      | Role                                            |
| ---------- | ----------------------------------------------- |
| `/`        | Scanner-first intake + results workspace        |
| `/about`   | Method / trust (product materials, not costume) |
| `/privacy` | Privacy boundaries (same materials)             |

## Visual system (crafted)

- **Scene:** Bright ordinary desk under cool window daylight; dark = evening desk
- **Color:** Restrained chrome; ink-blue accent as tool-mark on Analyze / live / verdict; full-palette verdict semantics
- **Type:** Heavy uppercase brand wordmark; calm product UI elsewhere (Geist Sans + Hack for data)
- **Depth:** Border-first panels; no soft SaaS card stacks, no glow theater
- **Intake:** Mail-compose pattern — URL field + solid Analyze CTA inline

## Standing product constraints

- Scanner-first IA (narrow story + wide console) — probe sidebar was atmosphere only, not IA
- Summary ↔ Full labelled switch; method notes live on `/about`
- No broad shadcnization; branded components under `components/scrutinix/*`
- Motion: state-only, 150–250ms; honor `prefers-reduced-motion`
- Tokens in `app/globals.css`; effects in `app/scrutinix.css`

## Ban list (short)

No CRT/radar/glow. No forensic/casefile/dossier/ledger/stamp. No cream/sand body or purple SaaS. No second-order “security seriousness” costume.

## Next

`$impeccable polish /` or targeted `$impeccable critique /` after visual QA.
