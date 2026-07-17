# Shape brief — Home `/` + public docs (scanner dashboard)

**Status:** Extended Instrument Casefile (2026-07-17). About/privacy + footer quiet pass.  
**Register:** Product (tool).  
**IA:** Scanner-first **kept** (narrow brand column + wide scan console). Not reopened.

Visual direction probes: **skipped** — harness has image gen, but this run commits to one lane for sequential overdrive (no pick gate).

---

## 1. Feature Summary

Scrutinix home is the public threat scanner: paste a URL (or short batch), watch eight signals stream, read a verdict with confidence and caveats, optionally reopen history. Redesign tears down terminal/radar/glow theater and installs a distinctive **instrument casefile** visual system that still serves hurried link-checking. `/about` and `/privacy` share the same folio / ledger materials.

## 2. Primary User Action

Paste a URL and start a scan — the console is the product; brand and support orbit it.

## 3. Design Direction

- **Color strategy:** Full palette for verdict semantics (safe / suspicious / malicious / critical); brand chrome stays **Restrained** cool steel ink. Accent only on primary analyze CTA, live stream, and active verdict.
- **Scene sentence:** Mid-afternoon at a bright desk under cool daylight, someone pastes a suspicious link before forwarding mail — anxious, needs calm certainty in seconds, not a cyberpunk cockpit. → Dual theme kept; **cool steel neutrals** (hue ~235–250), not warm cream and not CRT green.
- **Named anchors:** (1) forensic evidence ledger / casefile stamp, (2) precision lab instrument dials (clean arcs, no sonar), (3) Linear-grade density for controls — familiar affordances, distinctive materials.
- **Lane name:** Instrument Casefile.

### Keep

- Scanner-first intro grid (narrow story / wide console)
- Summary ↔ Full labelled `role="switch"`
- Compact support reference grid job (no long accordion essays)
- `globals.css` tokens vs `scrutinix.css` effects seam
- Branded scrutinix components (no broad shadcnization)
- Semantic verdict tokens and advisor correctness (plans 001–006)

### Kill

- Radar watermark + score-ring sonar/sweep
- Decorative LED glow, scan-line chrome, stage-in page theater as identity
- Side-stripe severity edges (`inset 3px left`) — replace with top rail / surface tint (impeccable ban)
- Terminal “hacker green glow” as brand signature
- **Footer marquee ticker** — replaced with a single quiet static status line
- Accent-tinted page wash / atmosphere overlays on public docs

### Anti-goals

- Generic SaaS cream / purple-indigo
- Second-order “editorial magazine security” or “cyberpunk neon”
- Particles / WebGL for wow (wrong register)

## 4. Scope

- **Fidelity:** Production-ready
- **Breadth:** Home `/`, `/about`, `/privacy`, shared footer chrome
- **Interactivity:** Shipped components
- **Time intent:** Overdrive → quieter → distill to shippable polish

## 5. Layout Strategy

1. Header: quiet chrome + threat progress rail when active
2. Hero band: brand wordmark + one line + **dominant intake panel**
3. Workspace: verdict casefile → signal lanes (Summary/Full) → history rail
4. Support: tight ledger reference grid below
5. Docs (`/about`, `/privacy`): folio masthead + exhibit index + dossier body  
   Rhythm: calm empty → taut live stream → decisive verdict stamp

## 6. Key States

| State                                     | Feel / show                                               |
| ----------------------------------------- | --------------------------------------------------------- |
| Idle                                      | Quiet instrument; empty verdict invites paste             |
| Streaming                                 | Solid coverage meter; signal rows resolve; no radar sweep |
| Result safe/suspicious/malicious/critical | Verdict stamp + score dial; accent follows verdict        |
| Error / rate limit                        | Clear inline error; no false malicious                    |
| Empty history                             | Teach “scans stay on device”                              |
| Reduced motion                            | Instant state, no sweep/shimmer                           |

## 7. Interaction Model

URL → Analyze (Enter icon) → NDJSON stream fills verdict + signals → Summary/Full toggles density → export/share/rescan → support links for method/privacy. Motion = state only (150–250ms; `@property` verdict color; optional `@starting-style` on signal resolve).

## 8. Content Requirements

Keep existing product copy density; trim redundant theater labels. Support cards unchanged in job. No new marketing stats strip in hero. Public docs use shorter folio titles; exhibit index carries proof points.

## 9. Recommended References (impl)

`product.md` (loaded), `overdrive.md` / `quieter.md` / `distill.md` (in spirit), skill contrast rules.

## 10. Token strategy

- Retint `--sx-*` toward cool steel (slight chroma on brand hue)
- Keep verdict semantics as full-palette; tune for contrast on new surfaces
- Effects layer: casefile stamp (`.sx-folio-stamp`), ledger (`.sx-ledger`), top severity rails, instrument dial
- Skip `palette.mjs` seed — deliberate retint of committed `--sx-*` system

## Decisions locked

- Light vs dark default: system/`next-themes` (scene allows both).
- **Footer:** marquee **cut**; single static status line (latest signal note, or idle/stream).
- About/privacy: same Instrument Casefile system (folio + exhibit ledger), not leftover terminal aesthetic.
