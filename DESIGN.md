# DESIGN.md — Scrutinix (Daylight Desk)

**Register:** Product (tool UI).  
**Status:** Instrument Casefile **rejected**. Active lane: **Daylight Desk** (`DESIGN-HOME-SHAPE.md`).

## Source of truth

| Doc | Role |
| --- | --- |
| `DESIGN-REDIRECTION.md` | Grill locks (scene, IA, keep/kill, anti-references) |
| `DESIGN-HOME-SHAPE.md` | Shape brief for home + public docs |
| `PRODUCT.md` / `CONTEXT.md` | Product register + vocabulary |

## Surfaces (jobs)

| Route | Role |
| --- | --- |
| `/` | Scanner-first intake + results workspace |
| `/about` | Method / trust (product materials, not costume) |
| `/privacy` | Privacy boundaries (same materials) |

## Standing product constraints

- Scanner-first IA (narrow story + wide console)
- Summary ↔ Full labelled switch; compact support section
- No broad shadcnization; branded components under `components/scrutinix/*`
- Motion: state-only, 150–250ms; honor `prefers-reduced-motion`
- Tokens in `app/globals.css`; effects in `app/scrutinix.css` — Daylight Desk, not Casefile

## Ban list (short)

No CRT/radar/glow. No forensic/casefile/dossier/ledger/stamp. No cream/sand body or purple SaaS. No second-order “security seriousness” costume.

## Next

`$impeccable craft /` — implement Daylight Desk against the shape brief.
