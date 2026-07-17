# Shape brief — Home `/` (scanner dashboard)

**Status:** Asserted from user redesign brief (2026-07-17). Sequential `$impeccable overdrive /` authorized by same request.  
**Register:** Product (tool).  
**IA:** Scanner-first **kept** (narrow brand column + wide scan console). Not reopened.

Visual direction probes: **skipped** — harness has image gen, but this run commits to one lane for sequential overdrive (no pick gate).

---

## 1. Feature Summary

Scrutinix home is the public threat scanner: paste a URL (or short batch), watch eight signals stream, read a verdict with confidence and caveats, optionally reopen history. Redesign tears down terminal/radar/glow theater and installs a distinctive **instrument casefile** visual system that still serves hurried link-checking.

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

### Anti-goals

- Generic SaaS cream / purple-indigo
- Second-order “editorial magazine security” or “cyberpunk neon”
- Particles / WebGL for wow (wrong register)

## 4. Scope

- **Fidelity:** Production-ready  
- **Breadth:** Home `/` surface (shared tokens/effects may lightly affect about/privacy via shared edge classes)  
- **Interactivity:** Shipped components  
- **Time intent:** Overdrive to shippable polish

## 5. Layout Strategy

1. Header: quiet chrome + threat progress rail when active  
2. Hero band: brand wordmark + one line + **dominant scan console**  
3. Workspace: verdict casefile → signal lanes (Summary/Full) → history rail  
4. Support: tight reference cards below  
Rhythm: calm empty → taut live stream → decisive verdict stamp

## 6. Key States

| State | Feel / show |
| --- | --- |
| Idle | Quiet instrument; empty verdict invites paste |
| Streaming | Solid coverage meter; signal rows resolve; no radar sweep |
| Result safe/suspicious/malicious/critical | Verdict stamp + score dial; accent follows verdict |
| Error / rate limit | Clear inline error; no false malicious |
| Empty history | Teach “scans stay on device” |
| Reduced motion | Instant state, no sweep/shimmer/marquee |

## 7. Interaction Model

URL → Analyze (Enter icon) → NDJSON stream fills verdict + signals → Summary/Full toggles density → export/share/rescan → support links for method/privacy. Motion = state only (150–250ms; `@property` verdict color; optional `@starting-style` on signal resolve).

## 8. Content Requirements

Keep existing product copy density; trim redundant theater labels (“Awaiting target” can stay functional). Support cards unchanged in job. No new marketing stats strip in hero.

## 9. Recommended References (impl)

`product.md` (loaded), `animate.md` (state motion), `colorize.md` (verdict palette), skill contrast rules.

## 10. Token strategy

- Retint `--sx-bg*`, `--sx-surface*`, `--sx-text*` toward cool steel (slight chroma on brand hue)  
- Keep `--sx-safe|suspicious|malicious|critical|info|error` as full-palette semantics; tune for contrast on new surfaces  
- Effects layer: replace radar/LED/scan-line with casefile stamp, top severity rails, instrument dial, restrained progress fill  
- Skip `palette.mjs` seed — deliberate retint of committed `--sx-*` system

## Open questions (non-blocking defaults)

- Light vs dark default: keep system/`next-themes` (scene allows both).  
- Footer marquee: keep but quieter (reduced opacity / slower); kill only if it fights casefile calm.
